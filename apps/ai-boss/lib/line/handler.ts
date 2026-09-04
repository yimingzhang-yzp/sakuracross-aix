/**
 * 「CROSS スタッフ」アカウントの Webhook イベント処理(AI上司側)。
 *
 * - message(text)   → 応答中ローディング表示 → 質問応答 → replyToken で返信(プッシュ課金なし)
 * - message(その他) → テキストでの質問を促す定型文
 * - follow          → 仮スタッフ作成(未登録なら)+ あいさつ(記録・閲覧の明示を含む)
 * - unfollow        → ログのみ
 * - postback ai:*   → フェーズ1 では未使用(ログのみ)
 */
import type { AiClient } from '@sakura-cross/ai-client';
import {
  type LineEventContext,
  type LineEventHandler,
  type LineMessagingClient,
  type LineWebhookEvent,
  type Logger,
  consoleLogger,
  isMessageEvent,
  isTextMessageEvent,
  textMessage,
} from '@sakura-cross/line-router';

import { fetchLineDisplayName } from './client';
import { type AnswerOutcome, handleStaffQuestion } from '../chat/answer';
import type { KnowledgeRetriever } from '../knowledge/retriever';
import type { AiBossSettings } from '../settings';
import type { AiBossStore, StaffRecord } from '../store/types';

export interface AiLineHandlerDeps {
  store: AiBossStore;
  ai: AiClient;
  retriever: KnowledgeRetriever;
  messaging: LineMessagingClient;
  loadSettings: () => Promise<AiBossSettings>;
  logger?: Logger;
  now?: () => Date;
  /** 表示名取得(テストで差し替え)。既定は LINE プロフィール API */
  fetchDisplayName?: (userId: string) => Promise<string | null>;
  /** 応答結果のフック(テスト・監視用) */
  onAnswered?: (outcome: AnswerOutcome, staff: StaffRecord) => void;
}

/**
 * lineUserId から Staff を解決。未登録なら仮スタッフを作成(ASSUMPTIONS.md 参照)。
 */
export async function resolveStaff(
  store: AiBossStore,
  lineUserId: string,
  fetchDisplayName: (userId: string) => Promise<string | null>,
): Promise<{ staff: StaffRecord; created: boolean }> {
  const existing = await store.findStaffByLineUserId(lineUserId);
  if (existing) return { staff: existing, created: false };
  const displayName = await fetchDisplayName(lineUserId);
  const staff = await store.createProvisionalStaff({ lineUserId, displayName });
  return { staff, created: true };
}

export function createAiLineEventHandler(deps: AiLineHandlerDeps): LineEventHandler {
  const logger = deps.logger ?? consoleLogger;
  const fetchDisplayName = deps.fetchDisplayName ?? ((userId: string) => fetchLineDisplayName(userId));

  return async (event: LineWebhookEvent, context: LineEventContext): Promise<void> => {
    const userId = event.source?.userId;
    if (!userId || event.source?.type !== 'user') {
      logger.info('[ai-boss] 1:1 以外(グループ等)のイベントは無視', { type: event.type, source: event.source?.type });
      return;
    }

    switch (event.type) {
      case 'follow': {
        const { staff, created } = await resolveStaff(deps.store, userId, fetchDisplayName);
        const settings = await deps.loadSettings();
        const replyToken = (event as { replyToken?: string }).replyToken;
        if (replyToken) {
          await deps.messaging.replyMessage(replyToken, textMessage(settings.greeting));
        }
        await deps.store.audit({
          action: 'ai-boss.follow',
          targetType: 'Staff',
          targetId: staff.id,
          detail: { created, unblocked: (event as { follow?: { isUnblocked?: boolean } }).follow?.isUnblocked ?? false },
        });
        logger.info('[ai-boss] follow', { staffId: staff.id, created });
        return;
      }
      case 'unfollow': {
        logger.info('[ai-boss] unfollow', { userId });
        return;
      }
      case 'postback': {
        logger.info('[ai-boss] ai: postback はフェーズ1では未使用', { route: context.route.postback?.action });
        return;
      }
      case 'message':
        break;
      default:
        logger.info('[ai-boss] 未対応イベント', { type: event.type });
        return;
    }

    if (!isMessageEvent(event)) return;
    const settings = await deps.loadSettings();
    const { staff } = await resolveStaff(deps.store, userId, fetchDisplayName);

    if (!isTextMessageEvent(event)) {
      await deps.messaging.replyMessage(event.replyToken, textMessage(settings.nonTextReply));
      return;
    }

    const text = event.message.text.trim();
    if (!text) return;

    // 応答中表示(失敗しても本処理は続ける)
    deps.messaging.showLoadingAnimation(userId, 20).catch((error: unknown) => {
      logger.warn('[ai-boss] ローディング表示に失敗', { error: error instanceof Error ? error.message : String(error) });
    });

    const outcome = await handleStaffQuestion(
      {
        store: deps.store,
        ai: deps.ai,
        retriever: deps.retriever,
        settings,
        logger,
        now: deps.now,
      },
      { staff, text },
    );
    await deps.messaging.replyMessage(event.replyToken, textMessage(outcome.replyText));
    deps.onAnswered?.(outcome, staff);
    logger.info('[ai-boss] 応答', {
      staffId: staff.id,
      kind: outcome.kind,
      confidence: outcome.confidence,
      cited: outcome.citedDocTitles,
      ticketId: outcome.ticketId,
      latencyMs: outcome.latencyMs,
    });
  };
}

/**
 * shift: 宛てイベント(postback shift:* / follow / accountLink)を shift-payroll の内部 API に転送する。
 * 転送先未設定なら何もしない(ログのみ)。転送失敗は例外にしてルーターに再送させる。
 */
export function createShiftForwarder(options: {
  url: string | undefined;
  secret: string | undefined;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}): LineEventHandler {
  const logger = options.logger ?? consoleLogger;
  return async (event, context) => {
    if (!options.url) {
      logger.info('[ai-boss] shift 宛てイベントの転送先(SHIFT_PAYROLL_INTERNAL_URL)未設定のためスキップ', {
        type: event.type,
        action: context.route.postback?.action,
      });
      return;
    }
    if (!options.secret) {
      throw new Error('INTERNAL_API_SECRET が未設定のため shift-payroll へ転送できません');
    }
    const response = await (options.fetchImpl ?? fetch)(`${options.url.replace(/\/$/, '')}/api/internal/line-event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': options.secret },
      body: JSON.stringify({ destination: context.destination, event, route: context.route }),
    });
    if (!response.ok) {
      throw new Error(`shift-payroll への転送が ${response.status} を返しました`);
    }
  };
}
