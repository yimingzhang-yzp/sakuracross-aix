'use server';

import { businessDateTimeToDate, businessDateToDbValue, dbValueToBusinessDate, isBusinessDateString } from '@sakura-cross/business-date';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/auth/session';
import { audit, db, finalizedPeriods } from '@/lib/db';
import { PayrollLockedError, assertNotLocked } from '@/lib/payroll/compute';

function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function back(date: string, msg: { ok?: string; error?: string }): never {
  revalidatePath('/admin/attendance');
  const q = msg.ok ? `ok=${encodeURIComponent(msg.ok)}` : `error=${encodeURIComponent(msg.error ?? '')}`;
  redirect(`/admin/attendance?date=${date}&${q}`);
}

async function guardLock(date: string): Promise<string | null> {
  try {
    assertNotLocked(await finalizedPeriods(), date);
    return null;
  } catch (e) {
    return e instanceof PayrollLockedError ? e.message : String(e);
  }
}

export async function upsertTimeRecordAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const staffId = str(form, 'staffId');
  const date = str(form, 'date');
  if (!staffId || !date || !isBusinessDateString(date)) redirect('/admin/attendance');
  const lockError = await guardLock(date);
  if (lockError) back(date, { error: lockError });

  const clockInStr = str(form, 'clockIn');
  const clockOutStr = str(form, 'clockOut');
  const breakMinutes = Number(str(form, 'breakMinutes') ?? 0);
  const clockIn = clockInStr ? businessDateTimeToDate(date, clockInStr) : null;
  const clockOut = clockOutStr ? businessDateTimeToDate(date, clockOutStr) : null;
  if (clockIn && clockOut && clockOut <= clockIn) back(date, { error: '退勤が出勤より前になっています(翌朝の時刻は 10:00 より前を入力)' });

  const prisma = db();
  const rec = await prisma.timeRecord.upsert({
    where: { staffId_businessDate: { staffId, businessDate: businessDateToDbValue(date) } },
    update: { clockIn, clockOut, breakMinutes, editedByAdmin: true, approved: false },
    create: { staffId, businessDate: businessDateToDbValue(date), clockIn, clockOut, breakMinutes, editedByAdmin: true, source: 'ADMIN' },
  });
  await audit(session, 'timeRecord.edit', 'TimeRecord', rec.id, { date, clockIn, clockOut, breakMinutes });
  back(date, { ok: '打刻を保存しました(未承認に戻ります)' });
}

export async function approveTimeRecordAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const id = str(form, 'id');
  const date = str(form, 'date') ?? '';
  if (!id) redirect('/admin/attendance');
  const rec = await db().timeRecord.findUnique({ where: { id } });
  if (!rec) back(date, { error: '打刻が見つかりません' });
  const lockError = await guardLock(dbValueToBusinessDate(rec.businessDate));
  if (lockError) back(date, { error: lockError });
  await db().timeRecord.update({ where: { id }, data: { approved: true } });
  await audit(session, 'timeRecord.approve', 'TimeRecord', id);
  back(date, { ok: '承認しました' });
}

export async function approveAllMonthAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const month = str(form, 'month');
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  if (!m) redirect('/admin/attendance');
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const pad = (n: number) => String(n).padStart(2, '0');
  const first = `${year}-${pad(mon)}-01`;
  const last = `${year}-${pad(mon)}-${pad(new Date(Date.UTC(year, mon, 0)).getUTCDate())}`;
  const locked = await finalizedPeriods();
  const lockedInMonth = locked.filter((r) => r.periodStart <= last && r.periodEnd >= first);
  const result = await db().timeRecord.updateMany({
    where: {
      approved: false,
      clockIn: { not: null },
      clockOut: { not: null },
      businessDate: { gte: businessDateToDbValue(first), lte: businessDateToDbValue(last) },
      ...(lockedInMonth.length > 0 ? { NOT: lockedInMonth.map((r) => ({ businessDate: { gte: businessDateToDbValue(r.periodStart), lte: businessDateToDbValue(r.periodEnd) } })) } : {}),
    },
    data: { approved: true },
  });
  await audit(session, 'timeRecord.approveMonth', 'TimeRecord', null, { month, count: result.count });
  back(first, { ok: `${month} の打刻 ${result.count} 件を承認しました(出退勤が揃っているもののみ)` });
}

export async function addAdvancePaymentAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const staffId = str(form, 'staffId');
  const date = str(form, 'date');
  const amount = Number(str(form, 'amount'));
  if (!staffId || !date || !isBusinessDateString(date) || !Number.isInteger(amount) || amount <= 0) redirect('/admin/attendance');
  const lockError = await guardLock(date);
  if (lockError) back(date, { error: lockError });
  const row = await db().advancePayment.create({
    data: { staffId, businessDate: businessDateToDbValue(date), amount, paidBy: session.name, memo: str(form, 'memo') ?? null },
  });
  await audit(session, 'advancePayment.add', 'AdvancePayment', row.id, { staffId, date, amount });
  back(date, { ok: `日払い ${amount.toLocaleString('ja-JP')} 円を登録しました` });
}

export async function resolveCorrectionAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const id = str(form, 'id');
  const date = str(form, 'date') ?? '';
  const decision = str(form, 'decision');
  if (!id || (decision !== 'APPROVED' && decision !== 'REJECTED')) redirect('/admin/attendance');
  const prisma = db();
  const req = await prisma.timeRecordCorrectionRequest.findUnique({ where: { id } });
  if (!req || req.status !== 'PENDING') back(date, { error: '申請が見つからないか処理済みです' });
  const bdate = dbValueToBusinessDate(req.businessDate);

  if (decision === 'APPROVED') {
    const lockError = await guardLock(bdate);
    if (lockError) back(date, { error: lockError });
    const existing = await prisma.timeRecord.findUnique({ where: { staffId_businessDate: { staffId: req.staffId, businessDate: req.businessDate } } });
    await prisma.timeRecord.upsert({
      where: { staffId_businessDate: { staffId: req.staffId, businessDate: req.businessDate } },
      update: {
        clockIn: req.requestedClockIn ?? existing?.clockIn ?? null,
        clockOut: req.requestedClockOut ?? existing?.clockOut ?? null,
        breakMinutes: req.requestedBreakMinutes ?? existing?.breakMinutes ?? 0,
        editedByAdmin: true,
        approved: true,
      },
      create: {
        staffId: req.staffId,
        businessDate: req.businessDate,
        clockIn: req.requestedClockIn,
        clockOut: req.requestedClockOut,
        breakMinutes: req.requestedBreakMinutes ?? 0,
        editedByAdmin: true,
        approved: true,
        source: 'CORRECTION',
      },
    });
  }
  await prisma.timeRecordCorrectionRequest.update({ where: { id }, data: { status: decision, resolvedBy: session.name, resolvedAt: new Date() } });
  await audit(session, `correction.${decision.toLowerCase()}`, 'TimeRecordCorrectionRequest', id, { businessDate: bdate });

  const staff = await prisma.staff.findUnique({ where: { id: req.staffId } });
  if (staff?.lineUserId) {
    const { enqueueLinePush } = await import('@/lib/line/queue');
    await enqueueLinePush(
      staff.lineUserId,
      [{ type: 'text', text: decision === 'APPROVED' ? `${bdate} の打刻修正申請が承認され、勤怠に反映されました。` : `${bdate} の打刻修正申請は承認されませんでした。店長に確認してください。` }],
      { kind: 'CORRECTION_RESULT', ref: id },
    );
  }
  back(date, { ok: decision === 'APPROVED' ? '申請を承認し勤怠に反映しました' : '申請を却下しました' });
}
