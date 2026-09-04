/**
 * Webhook ハンドラの組み立て
 *
 * 署名検証 → JSON 解析 → 冪等性チェック → 振分け → ハンドラ呼び出し を1本にまとめる。
 * フレームワーク非依存(生ボディとヘッダ値だけを受け取る)なので、
 * Next.js Route Handler からは `await req.text()` と `req.headers.get('x-line-signature')` を渡せばよい。
 */
import type { WebhookEventMeta, WebhookEventStore } from './idempotency.js';
import { type RouteDecision, type RouteNamespace, expandRouteTarget, routeEvent } from './routing.js';
import { verifyLineSignature } from './signature.js';
import { type LineWebhookBody, type LineWebhookEvent, type Logger, consoleLogger } from './types.js';

export interface LineEventContext {
  route: RouteDecision;
  /** Webhook を受信したボットのユーザー ID */
  destination: string;
  /** どの名前空間として呼ばれているか(both のとき区別に使う) */
  namespace: RouteNamespace;
}

export type LineEventHandler = (event: LineWebhookEvent, context: LineEventContext) => Promise<void> | void;

export interface LineWebhookHandlerOptions {
  /**
   * チャネルシークレット。未設定かつ NODE_ENV !== 'production' のときは
   * 署名検証をスキップして警告を出す(ローカル開発のモック動作)。
   * 本番で未設定の場合は生成時に例外。
   */
  channelSecret?: string;
  eventStore: WebhookEventStore;
  handlers: Partial<Record<RouteNamespace, LineEventHandler>>;
  /** 振分け先が無い / ignore のイベントを受け取る(任意) */
  onIgnored?: (event: LineWebhookEvent, route: RouteDecision) => Promise<void> | void;
  /** ストアに記録するチャネル名(例: 'STAFF') */
  channel?: string;
  logger?: Logger;
  /** 明示的に署名検証をスキップする(テスト用途のみ)。既定は channelSecret 未設定かつ非本番のとき true */
  allowUnverified?: boolean;
  nodeEnv?: string;
}

export interface LineWebhookFailure {
  webhookEventId: string;
  eventType: string;
  error: string;
}

export interface LineWebhookResultBody {
  ok: boolean;
  message?: string;
  received: number;
  processed: number;
  duplicates: number;
  ignored: number;
  failed: LineWebhookFailure[];
}

export interface LineWebhookResult {
  status: 200 | 400 | 401 | 500;
  body: LineWebhookResultBody;
}

export interface LineWebhookRequest {
  rawBody: string | Uint8Array;
  signature: string | null | undefined;
}

export type LineWebhookHandler = (request: LineWebhookRequest) => Promise<LineWebhookResult>;

function emptyBody(message: string): LineWebhookResultBody {
  return { ok: false, message, received: 0, processed: 0, duplicates: 0, ignored: 0, failed: [] };
}

function parseBody(rawBody: string | Uint8Array): LineWebhookBody | null {
  try {
    const text = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody).toString('utf8');
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as { events?: unknown }).events)
    ) {
      return null;
    }
    const body = parsed as { destination?: unknown; events: unknown[] };
    return {
      destination: typeof body.destination === 'string' ? body.destination : '',
      events: body.events.filter(
        (event): event is LineWebhookEvent =>
          typeof event === 'object' && event !== null && typeof (event as { type?: unknown }).type === 'string',
      ),
    };
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createLineWebhookHandler(options: LineWebhookHandlerOptions): LineWebhookHandler {
  const logger = options.logger ?? consoleLogger;
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const channelSecret = options.channelSecret?.trim() || undefined;
  const allowUnverified = options.allowUnverified ?? (!channelSecret && nodeEnv !== 'production');

  if (!channelSecret && !allowUnverified) {
    throw new Error(
      'LINE チャネルシークレットが未設定です。本番環境では署名検証なしで Webhook を受け付けられません。',
    );
  }
  if (!channelSecret) {
    logger.warn(
      '[line-router] チャネルシークレット未設定のため署名検証をスキップします(開発モード)。本番では必ず設定してください。',
    );
  }

  return async ({ rawBody, signature }) => {
    if (channelSecret && !verifyLineSignature(rawBody, signature, channelSecret)) {
      logger.warn('[line-router] 署名検証に失敗しました', { hasSignature: Boolean(signature) });
      return { status: 401, body: emptyBody('invalid signature') };
    }

    const body = parseBody(rawBody);
    if (!body) {
      return { status: 400, body: emptyBody('invalid body') };
    }

    let processed = 0;
    let duplicates = 0;
    let ignored = 0;
    const failed: LineWebhookFailure[] = [];

    for (const event of body.events) {
      const eventId = typeof event.webhookEventId === 'string' ? event.webhookEventId : '';
      const meta: WebhookEventMeta = {
        eventType: event.type,
        channel: options.channel,
        receivedAt: new Date(),
      };

      if (eventId) {
        const claimed = await options.eventStore.tryClaim(eventId, meta);
        if (!claimed) {
          duplicates += 1;
          logger.info('[line-router] 処理済みイベントをスキップ', {
            webhookEventId: eventId,
            isRedelivery: event.deliveryContext?.isRedelivery ?? false,
          });
          continue;
        }
      } else {
        logger.warn('[line-router] webhookEventId が無いイベントを受信(冪等性チェック不可)', {
          type: event.type,
        });
      }

      const route = routeEvent(event);
      const namespaces = expandRouteTarget(route.target).filter((ns) => options.handlers[ns]);

      try {
        if (namespaces.length === 0) {
          ignored += 1;
          await options.onIgnored?.(event, route);
          continue;
        }
        for (const namespace of namespaces) {
          const handler = options.handlers[namespace];
          if (!handler) continue;
          await handler(event, { route, destination: body.destination, namespace });
        }
        processed += 1;
      } catch (error) {
        const message = errorMessage(error);
        logger.error('[line-router] イベント処理に失敗', {
          webhookEventId: eventId,
          type: event.type,
          error: message,
        });
        failed.push({ webhookEventId: eventId, eventType: event.type, error: message });
        if (eventId) {
          // 再送時に再処理できるよう予約を解除する
          try {
            await options.eventStore.release(eventId);
          } catch (releaseError) {
            logger.error('[line-router] 予約解除に失敗', {
              webhookEventId: eventId,
              error: errorMessage(releaseError),
            });
          }
        }
      }
    }

    return {
      status: failed.length > 0 ? 500 : 200,
      body: {
        ok: failed.length === 0,
        received: body.events.length,
        processed,
        duplicates,
        ignored,
        failed,
      },
    };
  };
}
