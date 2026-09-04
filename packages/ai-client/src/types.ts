/**
 * Anthropic API クライアントの抽象化
 *
 * - アプリ層(AI上司・請求書管理)は `AiClient` インターフェースだけに依存する
 * - 実装は `@anthropic-ai/sdk` を使う Live と、キー未設定時・テスト用の Mock の 2 つ
 * - 出力は「テキスト」と「zod スキーマで検証された JSON」の 2 種類に限定し、
 *   モデル差し替え(`ANTHROPIC_MODEL`)や将来の SDK 変更の影響を最小にする
 */
import type { z } from 'zod';

/** 画像として渡せる MIME タイプ(Anthropic API の対応形式) */
export type AiImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: AiImageMediaType; base64: string }
  | { type: 'document'; mediaType: 'application/pdf'; base64: string; title?: string };

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string | AiContentPart[];
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface AiRequestBase {
  /** システムプロンプト。安定部分を先頭に置くとプロンプトキャッシュが効く */
  system?: string;
  messages: AiMessage[];
  /** 既定 4096。長文生成(Markdown 変換など)は明示的に増やす */
  maxTokens?: number;
  /** ログ・監査用のラベル(例: "ai-boss.answer") */
  purpose?: string;
  /** システムプロンプトをキャッシュ対象にする(既定 true) */
  cacheSystemPrompt?: boolean;
}

export interface AiTextRequest extends AiRequestBase {}

export interface AiJsonRequest<T> extends AiRequestBase {
  /** 出力を検証する zod スキーマ(構造化出力として API に渡す) */
  schema: z.ZodType<T>;
  /** スキーマ名(構造化出力のフォーマット名。既定 "output") */
  schemaName?: string;
}

export interface AiResultMeta {
  model: string;
  mode: 'live' | 'mock';
  usage: AiUsage;
  latencyMs: number;
  /** モデルが安全上の理由で応答を拒否した場合 true(content は空になる) */
  refused: boolean;
  stopReason: string | null;
}

export interface AiTextResult extends AiResultMeta {
  text: string;
}

export interface AiJsonResult<T> extends AiResultMeta {
  data: T;
  /** 検証前の生テキスト(デバッグ用) */
  rawText: string;
}

export interface AiClient {
  readonly mode: 'live' | 'mock';
  readonly model: string;
  generateText(request: AiTextRequest): Promise<AiTextResult>;
  generateJson<T>(request: AiJsonRequest<T>): Promise<AiJsonResult<T>>;
}

/**
 * アプリ層が捕捉する統一エラー。`retryable` が true のものは Job キューで再試行する。
 */
export class AiClientError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AiClientError';
  }
}

/** ロガーの最小インターフェース(line-router と同じ形) */
export interface AiLogger {
  debug?(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export const consoleAiLogger: AiLogger = {
  debug: (message, meta) => console.debug(message, meta ?? ''),
  info: (message, meta) => console.info(message, meta ?? ''),
  warn: (message, meta) => console.warn(message, meta ?? ''),
  error: (message, meta) => console.error(message, meta ?? ''),
};

export const silentAiLogger: AiLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** メッセージ配列からテキスト部分だけを連結して取り出す(モックのヒューリスティック用) */
export function extractText(content: AiMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is Extract<AiContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

/** 直近のユーザーメッセージのテキスト */
export function lastUserText(messages: AiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message && message.role === 'user') return extractText(message.content);
  }
  return '';
}
