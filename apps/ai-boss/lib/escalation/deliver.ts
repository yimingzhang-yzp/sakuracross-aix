/**
 * 店長回答の LINE 配信と、失敗時の Job キュー再試行(共通前提「失敗キューと再試行」)。
 *
 * 配信はプッシュ(有料枠)を使う。replyToken は発行後 1 分しか使えないため、
 * 店長が後から回答する本ユースケースでは避けられない。
 */
import type { LineMessagingClient, Logger } from '@sakura-cross/line-router';
import { textMessage } from '@sakura-cross/line-router';

import { type AiBossSettings, renderTemplate } from '../settings';
import type { AiBossStore, JobRecord } from '../store/types';

export const JOB_KIND_LINE_PUSH = 'LINE_PUSH';

export interface LinePushJobPayload {
  to: string;
  text: string;
  /** 配信成功時に deliveredAt を埋めるチケット(任意) */
  ticketId?: string;
}

/** 再試行間隔(指数バックオフ): 1 回目失敗→5 分後、2 回目→30 分後、3 回目→FAILED */
export function nextRetryDelayMs(attempts: number): number | null {
  if (attempts >= 3) return null;
  return attempts === 1 ? 5 * 60 * 1000 : 30 * 60 * 1000;
}

export function buildManagerAnswerText(settings: AiBossSettings, question: string, answer: string): string {
  return renderTemplate(settings.managerAnswerTemplate, { question, answer });
}

export interface DeliverResult {
  delivered: boolean;
  queuedJobId: string | null;
  reason: string | null;
}

/**
 * チケットの店長回答を質問者へプッシュする。失敗時は Job に積んで cron で再試行する。
 */
export async function deliverManagerAnswer(
  deps: { store: AiBossStore; messaging: LineMessagingClient; settings: AiBossSettings; logger?: Logger; now?: () => Date },
  ticketId: string,
): Promise<DeliverResult> {
  const now = deps.now ? deps.now() : new Date();
  const ticket = await deps.store.getEscalation(ticketId);
  if (!ticket) return { delivered: false, queuedJobId: null, reason: 'チケットが見つかりません' };
  if (!ticket.managerAnswer) return { delivered: false, queuedJobId: null, reason: '店長回答がありません' };
  if (!ticket.staffLineUserId) {
    return { delivered: false, queuedJobId: null, reason: 'スタッフに LINE が紐付いていないため配信できません' };
  }
  const text = buildManagerAnswerText(deps.settings, ticket.question, ticket.managerAnswer);
  try {
    await deps.messaging.pushMessage(ticket.staffLineUserId, textMessage(text));
    await deps.store.updateEscalation(ticketId, { deliveredAt: now });
    return { delivered: true, queuedJobId: null, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger?.warn('[ai-boss] 店長回答のプッシュに失敗。Job キューへ登録', { ticketId, error: message });
    const payload: LinePushJobPayload = { to: ticket.staffLineUserId, text, ticketId };
    const job = await deps.store.enqueueJob(JOB_KIND_LINE_PUSH, payload, new Date(now.getTime() + 5 * 60 * 1000));
    return { delivered: false, queuedJobId: job.id, reason: message };
  }
}

export interface ProcessJobsResult {
  processed: number;
  succeeded: number;
  retried: number;
  failed: JobRecord[];
}

/**
 * 実行時刻の来た LINE_PUSH ジョブを処理する(cron から呼ぶ)。
 */
export async function processLinePushJobs(
  deps: { store: AiBossStore; messaging: LineMessagingClient; logger?: Logger; now?: () => Date },
  limit = 20,
): Promise<ProcessJobsResult> {
  const now = deps.now ? deps.now() : new Date();
  const jobs = await deps.store.claimDueJobs(JOB_KIND_LINE_PUSH, limit, now);
  const result: ProcessJobsResult = { processed: jobs.length, succeeded: 0, retried: 0, failed: [] };
  for (const job of jobs) {
    const payload = job.payload as Partial<LinePushJobPayload>;
    try {
      if (!payload.to || !payload.text) throw new Error('payload に to / text がありません');
      await deps.messaging.pushMessage(payload.to, textMessage(payload.text));
      await deps.store.completeJob(job.id);
      if (payload.ticketId) {
        await deps.store.updateEscalation(payload.ticketId, { deliveredAt: now }).catch(() => undefined);
      }
      result.succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const delay = nextRetryDelayMs(job.attempts);
      const updated = await deps.store.failJob(job.id, message, delay === null ? null : new Date(now.getTime() + delay));
      if (updated.status === 'FAILED') {
        result.failed.push(updated);
        deps.logger?.error('[ai-boss] LINE_PUSH ジョブが最大試行回数に達しました', { jobId: job.id, error: message });
      } else {
        result.retried += 1;
      }
    }
  }
  return result;
}
