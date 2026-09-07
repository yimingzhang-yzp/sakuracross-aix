'use server';

import { addBusinessDays, businessDateToDbValue, dbValueToBusinessDate, isBusinessDateString } from '@sakura-cross/business-date';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireAdmin } from '@/lib/auth/session';
import { audit, db } from '@/lib/db';
import { expandTemplates } from '@/lib/scheduling/templates';
import { STAFF_ROLES, type StaffRole } from '@/lib/scheduling/types';

const eventTypeEnum = z.enum(['NORMAL', 'BIG_EVENT', 'RENTAL', 'CLOSED']);

function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function back(date: string, message: { ok?: string; error?: string }): never {
  const q = message.ok ? `ok=${encodeURIComponent(message.ok)}` : `error=${encodeURIComponent(message.error ?? '')}`;
  revalidatePath(`/admin/calendar/${date}`);
  revalidatePath('/admin/calendar');
  redirect(`/admin/calendar/${date}?${q}`);
}

export async function upsertBusinessDayAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const date = str(form, 'date');
  if (!date || !isBusinessDateString(date)) redirect('/admin/calendar');
  const eventType = eventTypeEnum.parse(str(form, 'eventType') ?? 'NORMAL');
  const crowd = str(form, 'expectedCrowd');
  const day = await db().businessDay.upsert({
    where: { businessDate: businessDateToDbValue(date) },
    update: { eventType, eventName: str(form, 'eventName') ?? null, expectedCrowd: crowd ? Number(crowd) : null, note: str(form, 'note') ?? null },
    create: {
      businessDate: businessDateToDbValue(date),
      eventType,
      eventName: str(form, 'eventName') ?? null,
      expectedCrowd: crowd ? Number(crowd) : null,
      note: str(form, 'note') ?? null,
    },
  });
  await audit(session, 'businessDay.upsert', 'BusinessDay', day.id, { date, eventType });
  back(date, { ok: '保存しました' });
}

export async function expandTemplateAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const date = str(form, 'date');
  if (!date || !isBusinessDateString(date)) redirect('/admin/calendar');
  const prisma = db();
  const day = await prisma.businessDay.findUnique({ where: { businessDate: businessDateToDbValue(date) } });
  if (!day) back(date, { error: '営業日が未登録です' });
  const templates = await prisma.staffingTemplate.findMany({ where: { eventType: day.eventType }, orderBy: { sortOrder: 'asc' } });
  if (templates.length === 0) back(date, { error: `「${day.eventType}」のテンプレートが未登録です(マスタ > 必要人員テンプレート)` });
  const drafts = expandTemplates(date, templates.map((t) => ({ roleNeeded: t.roleNeeded as StaffRole, startTime: t.startTime, endTime: t.endTime, headcount: t.headcount })));
  await prisma.$transaction([
    prisma.staffingRequirement.deleteMany({ where: { businessDayId: day.id } }),
    prisma.staffingRequirement.createMany({ data: drafts.map((d) => ({ businessDayId: day.id, ...d })) }),
  ]);
  await audit(session, 'businessDay.expandTemplate', 'BusinessDay', day.id, { date, rows: drafts.length });
  back(date, { ok: `テンプレートから ${drafts.length} 行を展開しました` });
}

export async function addRequirementAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const date = str(form, 'date');
  if (!date || !isBusinessDateString(date)) redirect('/admin/calendar');
  const parsed = z
    .object({
      roleNeeded: z.enum(STAFF_ROLES as [string, ...string[]]),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
      headcount: z.coerce.number().int().min(1),
    })
    .safeParse({ roleNeeded: str(form, 'roleNeeded'), startTime: str(form, 'startTime'), endTime: str(form, 'endTime'), headcount: str(form, 'headcount') });
  if (!parsed.success) back(date, { error: '入力内容を確認してください' });
  const prisma = db();
  const day = await prisma.businessDay.findUnique({ where: { businessDate: businessDateToDbValue(date) } });
  if (!day) back(date, { error: '営業日が未登録です' });
  let draft;
  try {
    [draft] = expandTemplates(date, [{ ...parsed.data, roleNeeded: parsed.data.roleNeeded as StaffRole }]);
  } catch (e) {
    back(date, { error: (e as Error).message });
  }
  await prisma.staffingRequirement.create({ data: { businessDayId: day.id, ...draft! } });
  await audit(session, 'requirement.add', 'BusinessDay', day.id, parsed.data);
  back(date, { ok: '必要人員を追加しました' });
}

export async function deleteRequirementAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const id = str(form, 'id');
  const date = str(form, 'date') ?? '';
  if (!id) redirect('/admin/calendar');
  await db().staffingRequirement.delete({ where: { id } });
  await audit(session, 'requirement.delete', 'StaffingRequirement', id);
  back(date, { ok: '削除しました' });
}

export async function bulkCreateDaysAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const month = str(form, 'month');
  const eventType = eventTypeEnum.parse(str(form, 'eventType') ?? 'NORMAL');
  const expand = form.get('expand') === '1';
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  if (!m) redirect('/admin/calendar');
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const pad = (n: number) => String(n).padStart(2, '0');
  const first = `${year}-${pad(mon)}-01`;
  const last = `${year}-${pad(mon)}-${pad(new Date(Date.UTC(year, mon, 0)).getUTCDate())}`;

  const prisma = db();

  // 日ごとに 1 クエリ投げると DB 往復が数十回になり関数がタイムアウトするため、
  // 「既存を一括取得 → 不足分を一括作成 → 必要人員を一括作成」の 4 クエリに抑える。
  const existing = await prisma.businessDay.findMany({
    where: { businessDate: { gte: businessDateToDbValue(first), lte: businessDateToDbValue(last) } },
    select: { businessDate: true },
  });
  const alreadyThere = new Set(existing.map((row) => dbValueToBusinessDate(row.businessDate)));

  const missing: string[] = [];
  for (let d = first; d <= last; d = addBusinessDays(d, 1)) {
    if (!alreadyThere.has(d)) missing.push(d);
  }

  if (missing.length === 0) {
    redirect(`/admin/calendar?month=${month}&ok=${encodeURIComponent('未登録の営業日はありませんでした')}`);
  }

  const created = await prisma.businessDay.createManyAndReturn({
    data: missing.map((d) => ({ businessDate: businessDateToDbValue(d), eventType })),
    select: { id: true, businessDate: true },
  });

  let requirementRows = 0;
  if (expand && eventType !== 'CLOSED') {
    const templates = await prisma.staffingTemplate.findMany({ where: { eventType }, orderBy: { sortOrder: 'asc' } });
    if (templates.length > 0) {
      const rows = created.flatMap((day) => {
        const businessDate = dbValueToBusinessDate(day.businessDate);
        const drafts = expandTemplates(
          businessDate,
          templates.map((t) => ({ roleNeeded: t.roleNeeded as StaffRole, startTime: t.startTime, endTime: t.endTime, headcount: t.headcount })),
        );
        return drafts.map((x) => ({ businessDayId: day.id, ...x }));
      });
      if (rows.length > 0) {
        await prisma.staffingRequirement.createMany({ data: rows });
        requirementRows = rows.length;
      }
    }
  }

  await audit(session, 'businessDay.bulkCreate', 'BusinessDay', null, { month, eventType, created: created.length, requirementRows });
  revalidatePath('/admin/calendar');
  const suffix = expand && eventType !== 'CLOSED'
    ? requirementRows > 0
      ? ` / 必要人員 ${requirementRows} 行を展開`
      : ' / テンプレートが未登録のため必要人員は作成されていません'
    : '';
  redirect(`/admin/calendar?month=${month}&ok=${encodeURIComponent(`${created.length} 日を作成しました${suffix}`)}`);
}
