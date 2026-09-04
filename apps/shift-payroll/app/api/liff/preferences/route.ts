import { addBusinessDays, businessDateToDbValue, dbValueToBusinessDate } from '@sakura-cross/business-date';
import { getPrisma } from '@sakura-cross/shared-db';
import { z } from 'zod';

import { badRequest, identifyLiffRequest, resolveStaff, unauthorized } from '@/lib/liff/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const identity = await identifyLiffRequest(request);
  if (!identity) return unauthorized();
  const staff = await resolveStaff(identity);
  if (!staff) return Response.json({ error: 'unregistered' }, { status: 403 });

  const prisma = getPrisma();
  const periods = await prisma.shiftPeriod.findMany({
    where: { periodEnd: { gte: businessDateToDbValue(addBusinessDays(dbValueToBusinessDate(new Date()), -1)) } },
    orderBy: { periodStart: 'asc' },
    take: 4,
  });
  const result = [];
  for (const p of periods) {
    const start = dbValueToBusinessDate(p.periodStart);
    const end = dbValueToBusinessDate(p.periodEnd);
    const [days, prefs] = await Promise.all([
      prisma.businessDay.findMany({ where: { businessDate: { gte: p.periodStart, lte: p.periodEnd } }, select: { businessDate: true, eventType: true, eventName: true } }),
      prisma.shiftPreference.findMany({ where: { staffId: staff.id, businessDate: { gte: p.periodStart, lte: p.periodEnd } } }),
    ]);
    const dayInfo = new Map(days.map((d) => [dbValueToBusinessDate(d.businessDate), d]));
    const prefMap = new Map(prefs.map((x) => [dbValueToBusinessDate(x.businessDate), x.availability]));
    const dates = [];
    for (let d = start; d <= end; d = addBusinessDays(d, 1)) {
      const info = dayInfo.get(d);
      dates.push({ date: d, closed: info?.eventType === 'CLOSED', eventName: info?.eventName ?? null, availability: prefMap.get(d) ?? null });
    }
    result.push({
      id: p.id,
      start,
      end,
      deadline: p.preferenceDeadline.toISOString(),
      status: p.status,
      editable: p.status !== 'CONFIRMED',
      submittedCount: prefs.length,
      dates,
    });
  }
  return Response.json({ periods: result });
}

const putSchema = z.object({
  periodId: z.string().min(1),
  preferences: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.enum(['OK', 'NG', 'EARLY_ONLY', 'LATE_ONLY'])),
});

export async function PUT(request: Request): Promise<Response> {
  const identity = await identifyLiffRequest(request);
  if (!identity) return unauthorized();
  const staff = await resolveStaff(identity);
  if (!staff) return Response.json({ error: 'unregistered' }, { status: 403 });
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest('入力内容が不正です');

  const prisma = getPrisma();
  const period = await prisma.shiftPeriod.findUnique({ where: { id: parsed.data.periodId } });
  if (!period) return badRequest('期間が見つかりません');
  if (period.status === 'CONFIRMED') return badRequest('この期間のシフトは確定済みのため希望を変更できません。店長に連絡してください。');
  const start = dbValueToBusinessDate(period.periodStart);
  const end = dbValueToBusinessDate(period.periodEnd);

  let saved = 0;
  for (const [date, availability] of Object.entries(parsed.data.preferences)) {
    if (date < start || date > end) continue;
    await prisma.shiftPreference.upsert({
      where: { staffId_businessDate: { staffId: staff.id, businessDate: businessDateToDbValue(date) } },
      update: { availability, submittedAt: new Date() },
      create: { staffId: staff.id, businessDate: businessDateToDbValue(date), availability },
    });
    saved++;
  }
  const late = new Date() > period.preferenceDeadline;
  return Response.json({ ok: true, saved, late });
}
