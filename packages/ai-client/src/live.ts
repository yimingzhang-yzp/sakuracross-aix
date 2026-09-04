/**
 * `@anthropic-ai/sdk` を使う実装。
 *
 * - JSON 出力は構造化出力(`output_config.format` + zod)で受け、スキーマ検証済みの値を返す
 * - システムプロンプトは `cache_control` を付けてプロンプトキャッシュの対象にする
 * - SDK の型付き例外を `AiClientError`(retryable 判定付き)に変換する
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import {
  type AiClient,
  AiClientError,
  type AiJsonRequest,
  type AiJsonResult,
  type AiLogger,
  type AiMessage,
  type AiResultMeta,
  type AiTextRequest,
  type AiTextResult,
  consoleAiLogger,
} from './types.js';

export interface LiveAiClientOptions {
  apiKey: string;
  model: string;
  /** 既定 60,000ms。SDK の timeout はミリ秒 */
  timeoutMs?: number;
  /** 既定 2(SDK 既定と同じ) */
  maxRetries?: number;
  logger?: AiLogger;
  /** テスト用に SDK インスタンスを差し替える */
  sdk?: Anthropic;
}

const DEFAULT_MAX_TOKENS = 4096;

function toSdkMessages(messages: AiMessage[]): Anthropic.MessageParam[] {
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return { role: message.role, content: message.content };
    }
    const blocks: Anthropic.ContentBlockParam[] = message.content.map((part) => {
      switch (part.type) {
        case 'text':
          return { type: 'text', text: part.text };
        case 'image':
          return { type: 'image', source: { type: 'base64', media_type: part.mediaType, data: part.base64 } };
        case 'document':
          return {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: part.base64 },
            ...(part.title ? { title: part.title } : {}),
          };
      }
    });
    return { role: message.role, content: blocks };
  });
}

function toSystem(system: string | undefined, cache: boolean): Anthropic.TextBlockParam[] | undefined {
  if (!system) return undefined;
  return [cache ? { type: 'text', text: system, cache_control: { type: 'ephemeral' } } : { type: 'text', text: system }];
}

function toMeta(response: Anthropic.Message, model: string, startedAt: number): AiResultMeta {
  return {
    model,
    mode: 'live',
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? undefined,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? undefined,
    },
    latencyMs: Date.now() - startedAt,
    refused: response.stop_reason === 'refusal',
    stopReason: response.stop_reason,
  };
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function translateError(error: unknown, purpose: string | undefined): AiClientError {
  if (error instanceof AiClientError) return error;
  const label = purpose ? `[${purpose}] ` : '';
  if (error instanceof Anthropic.RateLimitError) {
    return new AiClientError(`${label}Anthropic API のレート制限に達しました`, true, error.status, { cause: error });
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new AiClientError(`${label}ANTHROPIC_API_KEY が無効です`, false, error.status, { cause: error });
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AiClientError(`${label}Anthropic API へのリクエストが不正です: ${error.message}`, false, error.status, {
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiClientError(`${label}Anthropic API に接続できません: ${error.message}`, true, undefined, {
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    const retryable = status === undefined || status >= 500 || status === 408 || status === 409 || status === 429;
    return new AiClientError(`${label}Anthropic API エラー(${status ?? '?'}): ${error.message}`, retryable, status, {
      cause: error,
    });
  }
  return new AiClientError(`${label}${error instanceof Error ? error.message : String(error)}`, false, undefined, {
    cause: error,
  });
}

export class LiveAiClient implements AiClient {
  readonly mode = 'live' as const;
  readonly model: string;
  private readonly sdk: Anthropic;
  private readonly logger: AiLogger;

  constructor(options: LiveAiClientOptions) {
    this.model = options.model;
    this.logger = options.logger ?? consoleAiLogger;
    this.sdk =
      options.sdk ??
      new Anthropic({
        apiKey: options.apiKey,
        timeout: options.timeoutMs ?? 60_000,
        maxRetries: options.maxRetries ?? 2,
      });
  }

  async generateText(request: AiTextRequest): Promise<AiTextResult> {
    const startedAt = Date.now();
    try {
      const response = await this.sdk.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: toSystem(request.system, request.cacheSystemPrompt ?? true),
        messages: toSdkMessages(request.messages),
      });
      const meta = toMeta(response, this.model, startedAt);
      this.log(request.purpose, meta);
      return { ...meta, text: meta.refused ? '' : textOf(response) };
    } catch (error) {
      throw translateError(error, request.purpose);
    }
  }

  async generateJson<T>(request: AiJsonRequest<T>): Promise<AiJsonResult<T>> {
    const startedAt = Date.now();
    try {
      const response = await this.sdk.messages.parse({
        model: this.model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: toSystem(request.system, request.cacheSystemPrompt ?? true),
        messages: toSdkMessages(request.messages),
        output_config: { format: zodOutputFormat(request.schema) },
      });
      const meta = toMeta(response, this.model, startedAt);
      this.log(request.purpose, meta);
      if (meta.refused) {
        throw new AiClientError(`[${request.purpose ?? 'json'}] モデルが応答を拒否しました`, false);
      }
      const rawText = textOf(response);
      const parsed = response.parsed_output;
      if (parsed === null || parsed === undefined) {
        // 構造化出力が欠けた場合の保険: 生テキストを zod で再検証する
        const fallback = request.schema.safeParse(safeJsonParse(rawText));
        if (!fallback.success) {
          throw new AiClientError(
            `[${request.purpose ?? 'json'}] モデル出力がスキーマに一致しません: ${fallback.error.message}`,
            true,
          );
        }
        return { ...meta, data: fallback.data, rawText };
      }
      return { ...meta, data: parsed, rawText };
    } catch (error) {
      throw translateError(error, request.purpose);
    }
  }

  private log(purpose: string | undefined, meta: AiResultMeta): void {
    this.logger.info('[ai-client] 生成完了', {
      purpose: purpose ?? null,
      model: meta.model,
      latencyMs: meta.latencyMs,
      inputTokens: meta.usage.inputTokens,
      outputTokens: meta.usage.outputTokens,
      cacheRead: meta.usage.cacheReadInputTokens ?? 0,
      stopReason: meta.stopReason,
    });
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
