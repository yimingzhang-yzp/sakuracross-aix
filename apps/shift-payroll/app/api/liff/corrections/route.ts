import { businessDateTimeToDate, businessDateToDbValue, dbValueToBusinessDate, isBusinessDateString } from '@sakura-cross/business-date';
import { getPrisma } from '@sakura-cross/shared-db';
import { z } from 'zod';

import { finalizedPeriods } from '@/lib/db';
import { badRequest, identifyLiffRequest, resolveStaff, unauthorized } from '@/lib/liff/auth';
import { notifyAdmins } from '@/lib/line/queue';
import { findLockingRun } from '@/lib/payroll/compute';

export const dynamic = 'force-dynamic';

const schema = z.object({
  businessDate: z.string().refine(isBusinessDateString, '日付が不正です'),
  clockIn: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  clockOut: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  breakMinutes: z.number().int().min(0).nullable().optional(),
  reason: z.string().trim().min(1).max(200),
});

export async function GET(request: Request): Promise<Response> {
  const identity = await identifyLiffRequest(request);
  if (!identity) return unauthorized();
  const staff = await resolveStaff(identity);
  if (!staff) return Response.json({ error: 'unregistered' }, { status: 403 });
  const rows = await getPrisma().timeRecordCorrectionRequest.findMany({ where: { staffId: staff.id }, orderBy: { createdAt: 'desc' }, take: 10 });
  return Response.json({
    requests: rows.map((r) => ({
      id: r.id,
      businessDate: dbValueToBusinessDate(r.businessDate),
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request): Promise<Response> {
  const identity = await identifyLiffRequest(request);
  if (!identity) return unauthorized();
  const staff = await resolveStaff(identity);
  if (!staff) return Response.json({ error: 'unregistered' }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? '入力内容が不正です');
  const d = parsed.data;
  if (!d.clockIn && !d.clockOut && d.breakMinutes == null) return badRequest('修正したい項目を入力してください');
  if (findLockingRun(await finalizedPeriods(), d.businessDate)) return badRequest('この営業日は給与確定済みのため修正できません。店長に連絡してください');

  const row = await getPrisma().timeRecordCorrectionRequest.create({
    data: {
      staffId: staff.id,
      businessDate: businessDateToDbValue(d.businessDate),
      requestedClockIn: d.clockIn ? businessDateTimeToDate(d.businessDate, d.clockIn) : null,
      requestedClockOut: d.clockOut ? businessDateTimeToDate(d.businessDate, d.clockOut) : null,
      requestedBreakMinutes: d.breakMinutes ?? null,
      reason: d.reason,
    },
  });
  await notifyAdmins(`🕒 打刻修正申請: ${staff.name} さん(${d.businessDate})。管理画面 > 勤怠管理 で承認してください。`, 'CORRECTION');
  return Response.json({ ok: true, id: row.id });
}
