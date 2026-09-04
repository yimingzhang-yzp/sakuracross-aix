import { businessDateToDbValue, toBusinessDate } from '@sakura-cross/business-date';
import { getPrisma } from '@sakura-cross/shared-db';
import { z } from 'zod';

import { finalizedPeriods } from '@/lib/db';
import { badRequest, identifyLiffRequest, resolveStaff, unauthorized } from '@/lib/liff/auth';
import { findLockingRun } from '@/lib/payroll/compute';

export const dynamic = 'force-dynamic';

async function todayState(staffId: string) {
  const prisma = getPrisma();
  const today = toBusinessDate(new Date());
  const dbDate = businessDateToDbValue(today);
  const [record, day] = await Promise.all([
    prisma.timeRecord.findUnique({ where: { staffId_businessDate: { staffId, businessDate: dbDate } } }),
    prisma.businessDay.findUnique({ where: { businessDate: dbDate }, include: { shiftAssignments: { where: { staffId, status: { in: ['CONFIRMED'] } } } } }),
  ]);
  const assignment = day?.shiftAssignments[0] ?? null;
  return {
    businessDate: today,
    record: record ? { clockIn: record.clockIn?.toISOString() ?? null, clockOut: record.clockOut?.toISOString() ?? null, approved: record.approved } : null,
    assignment: assignment ? { start: assignment.plannedStart.toISOString(), end: assignment.plannedEnd.toISOString(), role: assignment.roleAssigned } : null,
    canClockIn: !record?.clockIn,
    canClockOut: Boolean(record?.clockIn) && !record?.clockOut,
  };
}

export async function GET(request: Request): Promise<Response> {
  const identity = await identifyLiffRequest(request);
  if (!identity) return unauthorized();
  const staff = await resolveStaff(identity);
  if (!staff) return Response.json({ error: 'unregistered' }, { status: 403 });
  return Response.json(await todayState(staff.id));
}

const schema = z.object({
  action: z.enum(['in', 'out']),
  location: z.object({ lat: z.number(), lng: z.number(), accuracy: z.number().optional() }).nullable().optional(),
});

export async function POST(request: Request): Promise<Response> {
  const identity = await identifyLiffRequest(request);
  if (!identity) return unauthorized();
  const staff = await resolveStaff(identity);
  if (!staff) return Response.json({ error: 'unregistered' }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest('入力内容が不正です');

  const now = new Date();
  const today = toBusinessDate(now);
  if (findLockingRun(await finalizedPeriods(), today)) return badRequest('この営業日は給与確定済みのため打刻できません');
  const prisma = getPrisma();
  const where = { staffId_businessDate: { staffId: staff.id, businessDate: businessDateToDbValue(today) } };
  const existing = await prisma.timeRecord.findUnique({ where });
  const location = parsed.data.location ?? undefined;

  if (parsed.data.action === 'in') {
    if (existing?.clockIn) return badRequest('本日はすでに出勤打刻済みです');
    await prisma.timeRecord.upsert({
      where,
      update: { clockIn: now, clockInLocation: location },
      create: { staffId: staff.id, businessDate: businessDateToDbValue(today), clockIn: now, clockInLocation: location, source: 'LIFF' },
    });
  } else {
    if (!existing?.clockIn) return badRequest('出勤打刻がありません。先に出勤を押してください');
    if (existing.clockOut) return badRequest('本日はすでに退勤打刻済みです');
    await prisma.timeRecord.update({ where, data: { clockOut: now, clockOutLocation: location } });
  }
  return Response.json({ ok: true, at: now.toISOString(), ...(await todayState(staff.id)) });
}
