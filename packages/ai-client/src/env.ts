/**
 * 環境変数の解決とクライアント生成。
 *
 *   ANTHROPIC_API_KEY  … 未設定ならモックにフォールバック(ローカル開発)
 *   ANTHROPIC_MODEL    … 既定 claude-sonnet-4-6(共通前提書の指定)
 */
import { LiveAiClient, type LiveAiClientOptions } from './live.js';
import { MockAiClient, type MockResponder } from './mock.js';
import { type AiClient, type AiLogger, consoleAiLogger } from './types.js';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';

export interface AiEnv {
  apiKey: string | undefined;
  model: string;
  configured: boolean;
}

export function getAiEnv(env: Record<string, string | undefined> = process.env): AiEnv {
  const apiKey = env.ANTHROPIC_API_KEY?.trim() || undefined;
  const model = env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
  return { apiKey, model, configured: Boolean(apiKey) };
}

export interface CreateAiClientOptions extends Partial<Omit<LiveAiClientOptions, 'apiKey' | 'model'>> {
  apiKey?: string;
  model?: string;
  /** キー未設定時に使うモックの応答ロジック */
  mockResponder?: MockResponder;
  logger?: AiLogger;
  env?: Record<string, string | undefined>;
}

/**
 * API キーがあれば Live、無ければ Mock を返す。
 * 本番(NODE_ENV=production)でキー未設定の場合も起動は止めず、警告ログを出してモックにする
 * (AI 機能以外のヘルスチェック・管理画面は動かし続けるため)。
 */
export function createAiClient(options: CreateAiClientOptions = {}): AiClient {
  const env = getAiEnv(options.env);
  const logger = options.logger ?? consoleAiLogger;
  const apiKey = options.apiKey ?? env.apiKey;
  const model = options.model ?? env.model;
  if (!apiKey) {
    logger.warn('[ai-client] ANTHROPIC_API_KEY 未設定のためモッククライアントを使用します(AI 生成は行われません)');
    return new MockAiClient({ responder: options.mockResponder, logger });
  }
  return new LiveAiClient({
    apiKey,
    model,
    logger,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    sdk: options.sdk,
  });
}
