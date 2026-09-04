/**
 * cron 処理(Vercel Cron から Bearer CRON_SECRET 付きで呼ばれる)
 */
import { businessDateToDbValue, formatInTokyo } from '@sakura-cross/business-date';
import { getPrisma } from '@sakura-cross/shared-db';

import { loadSettings } from './db';
import { businessDateLabel } from './format';
import { preferenceReminderMessage } from './line/messages';
import { dispatchPendingJobs, notifyAdmins, pushToStaff } from './line/queue';

export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== 'production';
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

/** 希望提出リマインド(締切の N 日前・当日に未提出者へ) */
export async function sendPreferenceReminders(now = new Date()): Promise<{ periods: number; reminded: number }> {
  const prisma = getPrisma();
  const settings = await loadSettings();
  const todayCal = formatInTokyo(now, 'yyyy-MM-dd');
  const periods = await prisma.shiftPeriod.findMany({ where: { status: 'COLLECTING', preferenceDeadline: { gte: new Date(now.getTime() - 24 * 3_600_000) } } });
  let reminded = 0;
  let touched = 0;
  for (const period of periods) {
    const deadlineCal = formatInTokyo(period.preferenceDeadline, 'yyyy-MM-dd');
    for (const daysBefore of settings.preferenceReminderDaysBefore) {
      const target = new Date(`${deadlineCal}T00:00:00Z`);
      target.setUTCDate(target.getUTCDate() - daysBefore);
      const targetCal = target.toISOString().slice(0, 10);
      const tag = `d-${daysBefore}`;
      if (targetCal !== todayCal || period.remindersSent.includes(tag)) continue;

      const submitted = await prisma.shiftPreference.findMany({
        where: { businessDate: { gte: period.periodStart, lte: period.periodEnd } },
        select: { staffId: true },
        distinct: ['staffId'],
      });
      const submittedIds = new Set(submitted.map((s) => s.staffId));
      const targets = await prisma.staff.findMany({ where: { isActive: true, lineUserId: { not: null }, id: { notIn: [...submittedIds] } }, select: { id: true } });
      const label = `${businessDateLabel(period.periodStart.toISOString().slice(0, 10), true)}〜${businessDateLabel(period.periodEnd.toISOString().slice(0, 10))}`;
      reminded += await pushToStaff(
        targets.map((t) => t.id),
        [preferenceReminderMessage(label, period.preferenceDeadline, daysBefore === 0)],
        { kind: 'PREFERENCE_REMINDER', ref: period.id },
      );
      await prisma.shiftPeriod.update({ where: { id: period.id }, data: { remindersSent: { push: tag } } });
      touched++;
    }
  }
  return { periods: touched, reminded };
}

/** 期限切れの募集を EXPIRED に */
export async function expireOpenShifts(now = new Date()): Promise<number> {
  const result = await getPrisma().openShiftRequest.updateMany({ where: { status: 'OPEN', expiresAt: { lte: now } }, data: { status: 'EXPIRED', version: { increment: 1 } } });
  return result.count;
}

/** 毎朝 10:00 の死活監視レポート(沈黙=正常ではなく、正常であることを報告する) */
export async function sendHealthReport(now = new Date()): Promise<string> {
  const prisma = getPrisma();
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const [timeRecords, jobsDone, jobsFailed, jobsPending, openShifts, pendingCorrections, pendingRegistrations, upcoming] = await Promise.all([
    prisma.timeRecord.count({ where: { updatedAt: { gte: since } } }),
    prisma.job.count({ where: { status: 'DONE', updatedAt: { gte: since } } }),
    prisma.job.count({ where: { status: 'FAILED' } }),
    prisma.job.count({ where: { status: 'PENDING' } }),
    prisma.openShiftRequest.count({ where: { status: 'OPEN' } }),
    prisma.timeRecordCorrectionRequest.count({ where: { status: 'PENDING' } }),
    prisma.lineRegistrationRequest.count({ where: { status: 'PENDING' } }),
    prisma.shiftAssignment.count({ where: { status: 'CONFIRMED', businessDay: { businessDate: businessDateToDbValue(formatInTokyo(now, 'yyyy-MM-dd')) } } }),
  ]);
  const status = jobsFailed > 0 ? '⚠️ 要確認' : '✅ 正常';
  const text = [
    `【シフト給与 日次レポート】${formatInTokyo(now, 'M/d HH:mm')} ${status}`,
    `・直近24h の打刻/更新: ${timeRecords} 件`,
    `・LINE 送信: 成功 ${jobsDone} / 失敗 ${jobsFailed} / 待機 ${jobsPending}`,
    `・本日の確定シフト: ${upcoming} 件`,
    `・募集中の欠員: ${openShifts} 件`,
    `・承認待ち: 打刻修正 ${pendingCorrections} / LINE 登録 ${pendingRegistrations}`,
  ].join('\n');
  await notifyAdmins(text, 'HEALTH_REPORT');
  return text;
}

export { dispatchPendingJobs };
