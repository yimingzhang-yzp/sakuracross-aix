/**
 * LINE Messaging API クライアント(インターフェース + 実装 + モック)
 *
 * アクセストークン未設定のときはモックにフォールバックし、送信内容をログに残すだけにする。
 * これにより実キー無しでもアプリが起動・テストできる。
 *
 * コスト方針(共通前提より): 応答は可能な限り replyToken(無料)を使い、push は最小限にする。
 */
import { type Logger, consoleLogger } from './types.js';

export interface LineMessage {
  type: string;
  [key: string]: unknown;
}

export interface LineTextMessage extends LineMessage {
  type: 'text';
  text: string;
}

export interface LineMessagingClient {
  readonly mode: 'live' | 'mock';
  /** replyToken で返信(無料)。トークンは発行後 1 分以内・1 回のみ有効 */
  replyMessage(replyToken: string, messages: LineMessage | LineMessage[]): Promise<void>;
  /** プッシュ送信(有料枠を消費する)。必要最小限に */
  pushMessage(to: string, messages: LineMessage | LineMessage[]): Promise<void>;
  /** 1:1 トークで「応答中」ローディングを表示(5〜60 秒、5 秒単位) */
  showLoadingAnimation(chatId: string, loadingSeconds?: number): Promise<void>;
}

export interface LineMessagingClientOptions {
  channelAccessToken?: string;
  /** 既定: https://api.line.me */
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

export class LineApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    public readonly responseBody: string,
  ) {
    super(`LINE API ${endpoint} が ${status} を返しました: ${responseBody}`);
    this.name = 'LineApiError';
  }
}

export function textMessage(text: string): LineTextMessage {
  return { type: 'text', text };
}

function toArray(messages: LineMessage | LineMessage[]): LineMessage[] {
  const list = Array.isArray(messages) ? messages : [messages];
  if (list.length === 0 || list.length > 5) {
    throw new RangeError(`メッセージは 1〜5 件で指定してください(${list.length} 件)`);
  }
  return list;
}

export interface MockSentRecord {
  kind: 'reply' | 'push' | 'loading';
  target: string;
  messages: LineMessage[];
  at: Date;
}

/**
 * 送信内容をメモリに蓄積するモック。テストと、キー未設定時のローカル開発で使う。
 */
export class MockLineMessagingClient implements LineMessagingClient {
  readonly mode = 'mock' as const;
  readonly sent: MockSentRecord[] = [];

  constructor(private readonly logger: Logger = consoleLogger) {}

  async replyMessage(replyToken: string, messages: LineMessage | LineMessage[]): Promise<void> {
    const list = toArray(messages);
    this.sent.push({ kind: 'reply', target: replyToken, messages: list, at: new Date() });
    this.logger.info('[line-mock] reply', { replyToken, messages: list });
  }

  async pushMessage(to: string, messages: LineMessage | LineMessage[]): Promise<void> {
    const list = toArray(messages);
    this.sent.push({ kind: 'push', target: to, messages: list, at: new Date() });
    this.logger.info('[line-mock] push', { to, messages: list });
  }

  async showLoadingAnimation(chatId: string, loadingSeconds = 20): Promise<void> {
    this.sent.push({ kind: 'loading', target: chatId, messages: [], at: new Date() });
    this.logger.debug?.('[line-mock] loading', { chatId, loadingSeconds });
  }

  clear(): void {
    this.sent.length = 0;
  }
}

class HttpLineMessagingClient implements LineMessagingClient {
  readonly mode = 'live' as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly channelAccessToken: string,
    options: Pick<LineMessagingClientOptions, 'apiBaseUrl' | 'fetchImpl'>,
  ) {
    this.baseUrl = (options.apiBaseUrl ?? 'https://api.line.me').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async replyMessage(replyToken: string, messages: LineMessage | LineMessage[]): Promise<void> {
    await this.post('/v2/bot/message/reply', { replyToken, messages: toArray(messages) });
  }

  async pushMessage(to: string, messages: LineMessage | LineMessage[]): Promise<void> {
    await this.post('/v2/bot/message/push', { to, messages: toArray(messages) });
  }

  async showLoadingAnimation(chatId: string, loadingSeconds = 20): Promise<void> {
    const seconds = Math.min(60, Math.max(5, Math.round(loadingSeconds / 5) * 5));
    await this.post('/v2/bot/chat/loading/start', { chatId, loadingSeconds: seconds });
  }

  private async post(endpoint: string, payload: unknown): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.channelAccessToken}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new LineApiError(response.status, endpoint, text);
    }
  }
}

/**
 * アクセストークンがあれば実クライアント、無ければモックを返す。
 */
export function createLineMessagingClient(options: LineMessagingClientOptions = {}): LineMessagingClient {
  const logger = options.logger ?? consoleLogger;
  const token = options.channelAccessToken?.trim();
  if (!token) {
    logger.warn('[line-router] チャネルアクセストークン未設定のためモッククライアントを使用します');
    return new MockLineMessagingClient(logger);
  }
  return new HttpLineMessagingClient(token, options);
}
