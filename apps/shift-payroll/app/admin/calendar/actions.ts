'use server';

import { addBusinessDays, businessDateToDbValue, dbValueToBusinessDate, isBusinessDateString } from '@sakura-cross/business-date';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireAdmin } from '@/lib/auth/session';
import { audit, db, loadSettings } from '@/lib/db';
import { EVENT_TYPE_LABELS } from '@/lib/format';
import { AUTO_EVENT_TYPE, type EventTypeValue, suggestEventType } from '@/lib/scheduling/day-type';
import { expandTemplates } from '@/lib/scheduling/templates';
import { STAFF_ROLES, type StaffRole } from '@/lib/scheduling/types';

const eventTypeEnum = z.enum(['NORMAL', 'WEEKEND', 'BIG_EVENT', 'RENTAL', 'CLOSED']);

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
  const first = str(form, 'start');
  const last = str(form, 'end');
  const typeInput = str(form, 'eventType') ?? AUTO_EVENT_TYPE;
  const expand = form.get('expand') === '1';
  if (!first || !last || !isBusinessDateString(first) || !isBusinessDateString(last) || first > last) {
    redirect(`/admin/calendar?error=${encodeURIComponent('開始・終了の日付を確認してください')}`);
  }
  if (addBusinessDays(first, 366) < last) {
    redirect(`/admin/calendar?month=${first.slice(0, 7)}&error=${encodeURIComponent('一括作成できるのは 1 年分までです')}`);
  }
  const month = first.slice(0, 7);
  // AUTO なら曜日ルール(定休日 → 休業、週末営業の曜日 → 週末営業、それ以外 → 通常営業)
  const fixedType: EventTypeValue | null = typeInput === AUTO_EVENT_TYPE ? null : eventTypeEnum.parse(typeInput);
  const settings = await loadSettings();
  const typeFor = (date: string): EventTypeValue => fixedType ?? suggestEventType(date, settings);

  const prisma = db();

  // 日ごとに 1 クエリ投げると DB 往復が数十回になり関数がタイムアウトするため、
  // 「既存を一括取得 → 不足分を一括作成 → 必要人員を一括作成」の数クエリに抑える。
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
    data: missing.map((d) => ({ businessDate: businessDateToDbValue(d), eventType: typeFor(d) })),
    select: { id: true, businessDate: true, eventType: true },
  });

  // 種別ごとの作成数(結果メッセージ用)
  const countByType = new Map<EventTypeValue, number>();
  for (const day of created) countByType.set(day.eventType, (countByType.get(day.eventType) ?? 0) + 1);

  let requirementRows = 0;
  const typesWithoutTemplate: string[] = [];
  if (expand) {
    const openTypes = [...countByType.keys()].filter((t) => t !== 'CLOSED');
    const templates = openTypes.length > 0 ? await prisma.staffingTemplate.findMany({ where: { eventType: { in: openTypes } }, orderBy: { sortOrder: 'asc' } }) : [];
    const templatesByType = new Map<string, typeof templates>();
    for (const t of templates) templatesByType.set(t.eventType, [...(templatesByType.get(t.eventType) ?? []), t]);
    for (const t of openTypes) if (!templatesByType.has(t)) typesWithoutTemplate.push(t);

    const rows = created.flatMap((day) => {
      const list = templatesByType.get(day.eventType);
      if (!list || list.length === 0) return [];
      const businessDate = dbValueToBusinessDate(day.businessDate);
      const drafts = expandTemplates(
        businessDate,
        list.map((t) => ({ roleNeeded: t.roleNeeded as StaffRole, startTime: t.startTime, endTime: t.endTime, headcount: t.headcount })),
      );
      return drafts.map((x) => ({ businessDayId: day.id, ...x }));
    });
    if (rows.length > 0) {
      await prisma.staffingRequirement.createMany({ data: rows });
      requirementRows = rows.length;
    }
  }

  await audit(session, 'businessDay.bulkCreate', 'BusinessDay', null, {
    start: first,
    end: last,
    eventType: fixedType ?? AUTO_EVENT_TYPE,
    created: created.length,
    byType: Object.fromEntries(countByType),
    requirementRows,
  });
  revalidatePath('/admin/calendar');
  const summary = [...countByType.entries()].map(([t, n]) => `${EVENT_TYPE_LABELS[t] ?? t} ${n} 日`).join('・');
  const parts = [`${created.length} 日を作成しました(${summary})`];
  if (expand) {
    if (requirementRows > 0) parts.push(`必要人員 ${requirementRows} 行を展開`);
    if (typesWithoutTemplate.length > 0) parts.push(`テンプレート未登録: ${typesWithoutTemplate.map((t) => EVENT_TYPE_LABELS[t] ?? t).join('・')}(マスタ > 必要人員テンプレートで登録後「テンプレートから展開」)`);
  }
  redirect(`/admin/calendar?month=${month}&ok=${encodeURIComponent(parts.join(' / '))}`);
}
