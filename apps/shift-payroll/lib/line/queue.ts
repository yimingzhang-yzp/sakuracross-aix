/**
 * LINE プッシュ配信キュー(共通前提「失敗キューと再試行」)
 *
 * - 送信は必ず Job(kind = LINE_PUSH)に記録してから行う(監査・再試行・配信数の把握のため)
 * - 既定では即時送信を試み、失敗したら PENDING のまま残して cron(/api/cron/dispatch-jobs)が
 *   指数バックオフで最大 3 回再試行する。3 回失敗したら FAILED にし「CROSS 管理」へ通知する
 * - アクセストークン未設定時は line-router のモッククライアントが使われ、送信内容はログに出る
 */
import { type LineMessage, type LineMessagingClient, createLineMessagingClient, getLineChannelEnv } from '@sakura-cross/line-router';
import { type Prisma, getPrisma } from '@sakura-cross/shared-db';

export const LINE_PUSH_JOB = 'LINE_PUSH';

export type LineChannelKind = 'staff' | 'admin';

export interface LinePushPayload {
  channel: LineChannelKind;
  to: string;
  messages: LineMessage[];
  /** 用途タグ(SHIFT_CONFIRMED / OPEN_SHIFT / REMINDER / PAYSLIP / REGISTRATION / ALERT …) */
  kind: string;
  /** 関連 ID(任意) */
  ref?: string;
}

const clients: Partial<Record<LineChannelKind, LineMessagingClient>> = {};

export function lineClient(channel: LineChannelKind): LineMessagingClient {
  if (!clients[channel]) {
    clients[channel] = createLineMessagingClient({ channelAccessToken: getLineChannelEnv(channel).channelAccessToken });
  }
  return clients[channel]!;
}

/** テスト用: クライアントを差し替える */
export function __setLineClientForTest(channel: LineChannelKind, client: LineMessagingClient | undefined): void {
  clients[channel] = client;
}

export interface EnqueueOptions {
  channel?: LineChannelKind;
  kind?: string;
  ref?: string;
  /** 既定 true: キュー登録後すぐ送信を試みる */
  sendNow?: boolean;
}

export async function enqueueLinePush(
  to: string,
  messages: LineMessage[],
  options: EnqueueOptions = {},
): Promise<{ jobId: string; sent: boolean; error?: string }> {
  const prisma = getPrisma();
  const payload: LinePushPayload = {
    channel: options.channel ?? 'staff',
    to,
    messages,
    kind: options.kind ?? 'GENERIC',
    ref: options.ref,
  };
  const job = await prisma.job.create({
    data: { kind: LINE_PUSH_JOB, payload: payload as unknown as Prisma.InputJsonValue, status: 'PENDING' },
  });
  if (options.sendNow === false) return { jobId: job.id, sent: false };
  const result = await processJob(job.id);
  return { jobId: job.id, sent: result.ok, error: result.error };
}

/** スタッフ ID の配列へ同じメッセージを送る(LINE 未連携は除外) */
export async function pushToStaff(staffIds: string[], messages: LineMessage[], options: EnqueueOptions = {}): Promise<number> {
  if (staffIds.length === 0) return 0;
  const prisma = getPrisma();
  const staff = await prisma.staff.findMany({ where: { id: { in: staffIds }, lineUserId: { not: null } }, select: { lineUserId: true } });
  let sent = 0;
  for (const s of staff) {
    if (!s.lineUserId) continue;
    await enqueueLinePush(s.lineUserId, messages, options);
    sent++;
  }
  return sent;
}

/** 管理アカウントへの運用アラート(通知先未設定なら何もしない) */
export async function notifyAdmins(text: string, kind = 'ALERT'): Promise<void> {
  const to = process.env.LINE_ADMIN_NOTIFY_TO?.trim();
  if (!to) return;
  await enqueueLinePush(to, [{ type: 'text', text }], { channel: 'admin', kind });
}

function backoffMinutes(attempts: number): number {
  return Math.min(60, 2 ** attempts); // 2, 4, 8 … 分
}

/**
 * 1 件のジョブを送信する。PENDING → PROCESSING を条件付き UPDATE で予約するので、
 * cron と即時送信が同時に走っても二重送信しない。
 */
export async function processJob(jobId: string): Promise<{ ok: boolean; error?: string }> {
  const prisma = getPrisma();
  const claimed = await prisma.job.updateMany({
    where: { id: jobId, status: 'PENDING' },
    data: { status: 'PROCESSING', lockedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, error: '他のプロセスが処理中、または処理済み' };

  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  const payload = job.payload as unknown as LinePushPayload;
  try {
    await lineClient(payload.channel).pushMessage(payload.to, payload.messages);
    await prisma.job.update({ where: { id: jobId }, data: { status: 'DONE', attempts: { increment: 1 }, lastError: null, lockedAt: null } });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = job.attempts + 1;
    const exhausted = attempts >= job.maxAttempts;
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: exhausted ? 'FAILED' : 'PENDING',
        attempts,
        lastError: message,
        lockedAt: null,
        runAfter: new Date(Date.now() + backoffMinutes(attempts) * 60_000),
      },
    });
    if (exhausted && payload.channel !== 'admin') {
      await notifyAdmins(`⚠️ LINE 送信が ${attempts} 回失敗しました(${payload.kind})。管理画面 > LINE 送信ログ を確認してください。\n${message}`, 'JOB_FAILED');
    }
    return { ok: false, error: message };
  }
}

/** cron から呼ぶ: 実行時刻を過ぎた PENDING ジョブを順に処理 */
export async function dispatchPendingJobs(limit = 50): Promise<{ processed: number; succeeded: number; failed: number }> {
  const prisma = getPrisma();
  const jobs = await prisma.job.findMany({
    where: { kind: LINE_PUSH_JOB, status: 'PENDING', runAfter: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  let succeeded = 0;
  let failed = 0;
  for (const job of jobs) {
    const result = await processJob(job.id);
    if (result.ok) succeeded++;
    else failed++;
  }
  // 5 分以上 PROCESSING のまま残っているジョブはクラッシュとみなして戻す
  await prisma.job.updateMany({
    where: { kind: LINE_PUSH_JOB, status: 'PROCESSING', lockedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
    data: { status: 'PENDING', lockedAt: null },
  });
  return { processed: jobs.length, succeeded, failed };
}

/** FAILED を PENDING に戻して再試行可能にする(管理画面から) */
export async function retryJob(jobId: string): Promise<void> {
  await getPrisma().job.update({ where: { id: jobId }, data: { status: 'PENDING', attempts: 0, runAfter: new Date(), lastError: null } });
}
