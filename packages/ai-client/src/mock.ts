/**
 * モック実装。API キー未設定時のローカル開発とテストで使う。
 *
 * 応答内容はアプリ側が `responder` で注入する(AI上司なら「ナレッジ抜粋にキーワードが含まれていれば回答、
 * なければ no_answer」といったヒューリスティック)。未指定なら固定の応答を返す。
 * 呼び出し履歴は `calls` に残るのでテストで検証できる。
 */
import {
  type AiClient,
  AiClientError,
  type AiJsonRequest,
  type AiJsonResult,
  type AiLogger,
  type AiResultMeta,
  type AiTextRequest,
  type AiTextResult,
  silentAiLogger,
} from './types.js';

export interface MockResponder {
  /** JSON 要求に対する応答。返した値は schema で検証される */
  json?(request: AiJsonRequest<unknown>): unknown | Promise<unknown>;
  /** テキスト要求に対する応答 */
  text?(request: AiTextRequest): string | Promise<string>;
}

export interface MockAiClientOptions {
  model?: string;
  responder?: MockResponder;
  logger?: AiLogger;
  /** 応答の擬似遅延(ms)。既定 0 */
  latencyMs?: number;
}

export interface MockCallRecord {
  kind: 'text' | 'json';
  purpose?: string;
  system?: string;
  request: AiTextRequest | AiJsonRequest<unknown>;
  at: Date;
}

export const MOCK_MODEL = 'mock-claude';

export class MockAiClient implements AiClient {
  readonly mode = 'mock' as const;
  readonly model: string;
  readonly calls: MockCallRecord[] = [];
  private readonly responder: MockResponder;
  private readonly logger: AiLogger;
  private readonly latencyMs: number;

  constructor(options: MockAiClientOptions = {}) {
    this.model = options.model ?? MOCK_MODEL;
    this.responder = options.responder ?? {};
    this.logger = options.logger ?? silentAiLogger;
    this.latencyMs = options.latencyMs ?? 0;
  }

  async generateText(request: AiTextRequest): Promise<AiTextResult> {
    const startedAt = Date.now();
    this.calls.push({ kind: 'text', purpose: request.purpose, system: request.system, request, at: new Date() });
    await this.delay();
    const text = this.responder.text
      ? await this.responder.text(request)
      : '(モック応答)ANTHROPIC_API_KEY が未設定のため、AI 生成は行われていません。';
    this.logger.debug?.('[ai-mock] text', { purpose: request.purpose, text });
    return { ...this.meta(startedAt), text };
  }

  async generateJson<T>(request: AiJsonRequest<T>): Promise<AiJsonResult<T>> {
    const startedAt = Date.now();
    this.calls.push({ kind: 'json', purpose: request.purpose, system: request.system, request, at: new Date() });
    await this.delay();
    if (!this.responder.json) {
      throw new AiClientError(
        `[${request.purpose ?? 'json'}] モック responder に json ハンドラがありません。MockAiClient({ responder }) を指定してください`,
        false,
      );
    }
    const raw = await this.responder.json(request as AiJsonRequest<unknown>);
    const parsed = request.schema.safeParse(raw);
    if (!parsed.success) {
      throw new AiClientError(
        `[${request.purpose ?? 'json'}] モック応答がスキーマに一致しません: ${parsed.error.message}`,
        false,
      );
    }
    this.logger.debug?.('[ai-mock] json', { purpose: request.purpose, data: parsed.data });
    return { ...this.meta(startedAt), data: parsed.data, rawText: JSON.stringify(raw) };
  }

  clear(): void {
    this.calls.length = 0;
  }

  private meta(startedAt: number): AiResultMeta {
    return {
      model: this.model,
      mode: 'mock',
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: Date.now() - startedAt,
      refused: false,
      stopReason: 'end_turn',
    };
  }

  private async delay(): Promise<void> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
  }
}
