/**
 * シフト期間のユースケース(自動生成の実行・手修正の検証・確定と LINE 配信)
 */
import { addBusinessDays, businessDateToDbValue, dbValueToBusinessDate } from '@sakura-cross/business-date';
import { getPrisma } from '@sakura-cross/shared-db';

import { loadSettings } from '../db';
import { businessDateLabel } from '../format';
import { confirmedShiftMessage } from '../line/messages';
import { enqueueLinePush } from '../line/queue';
import { generateShifts, overlapsMinorNight, staffCanWorkRole, weekStartOf } from '../scheduling/generate';
import { assignmentSignature } from '../scheduling/templates';
import type { SchedAssignment, StaffRole } from '../scheduling/types';

export async function periodRange(periodId: string): Promise<{ id: string; start: string; end: string; status: string }> {
  const period = await getPrisma().shiftPeriod.findUniqueOrThrow({ where: { id: periodId } });
  return { id: period.id, start: dbValueToBusinessDate(period.periodStart), end: dbValueToBusinessDate(period.periodEnd), status: period.status };
}

/**
 * 自動生成: 期間内の AUTO/DRAFT 割当を作り直す。MANUAL・OPEN_SHIFT 由来と CONFIRMED は保持し、制約計算に含める。
 */
export async function runGeneration(periodId: string, actor: string): Promise<{ assigned: number; shortages: number; log: string[] }> {
  const prisma = getPrisma();
  const settings = await loadSettings();
  const period = await periodRange(periodId);

  const days = await prisma.businessDay.findMany({
    where: { businessDate: { gte: businessDateToDbValue(period.start), lte: businessDateToDbValue(period.end) }, eventType: { not: 'CLOSED' } },
    include: { staffingRequirements: true },
  });
  const dayIds = days.map((d) => d.id);

  // 作り直し対象: 期間内の DRAFT かつ AUTO
  await prisma.shiftAssignment.deleteMany({ where: { businessDayId: { in: dayIds }, status: 'DRAFT', source: 'AUTO' } });

  // 週上限の計算のため前後 7 日を含めて既存割当を読む
  const windowStart = addBusinessDays(period.start, -7);
  const windowEnd = addBusinessDays(period.end, 7);
  const existingRows = await prisma.shiftAssignment.findMany({
    where: {
      status: { in: ['DRAFT', 'CONFIRMED'] },
      businessDay: { businessDate: { gte: businessDateToDbValue(windowStart), lte: businessDateToDbValue(windowEnd) } },
    },
    include: { businessDay: true },
  });
  const existing: SchedAssignment[] = existingRows.map((a) => ({
    staffId: a.staffId,
    businessDate: dbValueToBusinessDate(a.businessDay.businessDate),
    role: a.roleAssigned as StaffRole,
    start: a.plannedStart,
    end: a.plannedEnd,
  }));

  const [staff, preferences] = await Promise.all([
    prisma.staff.findMany({ where: { isActive: true } }),
    prisma.shiftPreference.findMany({ where: { businessDate: { gte: businessDateToDbValue(period.start), lte: businessDateToDbValue(period.end) } } }),
  ]);

  // 既に埋まっている分を差し引いた必要人数でスロットを作る
  const requirements = days.flatMap((day) =>
    day.staffingRequirements.map((r) => {
      const bdStr = dbValueToBusinessDate(day.businessDate);
      const already = existingRows.filter(
        (a) => a.businessDayId === day.id && a.roleAssigned === r.roleNeeded && a.plannedStart.getTime() === r.startTime.getTime() && a.plannedEnd.getTime() === r.endTime.getTime(),
      ).length;
      return { id: r.id, businessDate: bdStr, role: r.roleNeeded as StaffRole, start: r.startTime, end: r.endTime, headcount: Math.max(0, r.headcount - already), dayId: day.id };
    }),
  );

  const result = generateShifts({
    requirements: requirements.filter((r) => r.headcount > 0),
    staff: staff.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role as StaffRole,
      skills: (s.skills as Record<string, unknown> | null) ?? null,
      employmentType: s.employmentType,
      isMinor: s.isMinor,
      hiredAt: s.hiredAt,
      isActive: s.isActive,
    })),
    preferences: preferences.map((p) => ({ staffId: p.staffId, businessDate: dbValueToBusinessDate(p.businessDate), availability: p.availability })),
    existingAssignments: existing,
    settings,
    now: new Date(),
    periodStart: period.start,
    periodEnd: period.end,
  });

  const dayIdByReq = new Map(requirements.map((r) => [r.id, r.dayId]));
  if (result.assignments.length > 0) {
    await prisma.shiftAssignment.createMany({
      data: result.assignments.map((a) => ({
        staffId: a.staffId,
        businessDayId: dayIdByReq.get(a.requirementId)!,
        roleAssigned: a.role,
        plannedStart: a.start,
        plannedEnd: a.end,
        status: 'DRAFT',
        source: 'AUTO',
      })),
    });
  }
  await prisma.shiftPeriod.update({ where: { id: periodId }, data: { status: period.status === 'CONFIRMED' ? 'GENERATING' : 'GENERATING', generatedAt: new Date() } });
  await prisma.auditLog.create({
    data: { actorName: actor, action: 'period.generate', targetType: 'ShiftPeriod', targetId: periodId, detail: { assigned: result.assignments.length, shortages: result.shortages.length } },
  });
  return { assigned: result.assignments.length, shortages: result.shortages.reduce((s, x) => s + x.missing, 0), log: result.log };
}

export interface PlacementCheck {
  ok: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * 手修正(追加・移動)時の制約チェック。エラーは禁止、警告は確認のうえ許容。
 */
export async function checkPlacement(staffId: string, requirementId: string, ignoreAssignmentId?: string): Promise<PlacementCheck> {
  const prisma = getPrisma();
  const settings = await loadSettings();
  const [staff, requirement] = await Promise.all([
    prisma.staff.findUniqueOrThrow({ where: { id: staffId } }),
    prisma.staffingRequirement.findUniqueOrThrow({ where: { id: requirementId }, include: { businessDay: true } }),
  ]);
  const businessDate = dbValueToBusinessDate(requirement.businessDay.businessDate);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!staff.isActive) errors.push(`${staff.name} は在籍外です`);
  if (staff.isMinor && overlapsMinorNight({ businessDate, start: requirement.startTime, end: requirement.endTime }, settings)) {
    errors.push(`${staff.name} は 18 歳未満のため ${settings.minorNightStart} 以降のシフトに入れません`);
  }
  const sameDay = await prisma.shiftAssignment.findFirst({
    where: { staffId, businessDayId: requirement.businessDayId, status: { in: ['DRAFT', 'CONFIRMED'] }, id: ignoreAssignmentId ? { not: ignoreAssignmentId } : undefined },
  });
  if (sameDay) errors.push(`${staff.name} は同じ営業日に既に割り当てられています`);

  if (!staffCanWorkRole(staff as never, requirement.roleNeeded as StaffRole)) warnings.push(`${staff.name} の職種と異なります(兼務スキル未登録)`);
  const pref = await prisma.shiftPreference.findUnique({ where: { staffId_businessDate: { staffId, businessDate: requirement.businessDay.businessDate } } });
  if (!pref) warnings.push('希望が未提出です');
  else if (pref.availability === 'NG') warnings.push('希望は × です');

  if (settings.weeklyHoursCap > 0) {
    const weekStart = weekStartOf(businessDate, settings.weekStartsOn);
    const weekEnd = addBusinessDays(weekStart, 6);
    const weekRows = await prisma.shiftAssignment.findMany({
      where: {
        staffId,
        status: { in: ['DRAFT', 'CONFIRMED'] },
        id: ignoreAssignmentId ? { not: ignoreAssignmentId } : undefined,
        businessDay: { businessDate: { gte: businessDateToDbValue(weekStart), lte: businessDateToDbValue(weekEnd) } },
      },
    });
    const minutes = weekRows.reduce((s, a) => s + (a.plannedEnd.getTime() - a.plannedStart.getTime()) / 60_000, 0) + (requirement.endTime.getTime() - requirement.startTime.getTime()) / 60_000;
    if (minutes > settings.weeklyHoursCap * 60) warnings.push(`週の合計が ${Math.round(minutes / 60)} 時間になり上限 ${settings.weeklyHoursCap} 時間を超えます`);
  }
  return { ok: errors.length === 0, warnings, errors };
}

/**
 * 確定: 期間内の DRAFT を CONFIRMED にし、前回通知から内容が変わったスタッフだけに LINE で本人分を配信する。
 */
export async function confirmPeriod(periodId: string, actor: string): Promise<{ confirmed: number; notified: number }> {
  const prisma = getPrisma();
  const period = await periodRange(periodId);
  const range = { gte: businessDateToDbValue(period.start), lte: businessDateToDbValue(period.end) };

  const confirmedResult = await prisma.shiftAssignment.updateMany({
    where: { status: 'DRAFT', businessDay: { businessDate: range } },
    data: { status: 'CONFIRMED' },
  });
  await prisma.shiftPeriod.update({ where: { id: periodId }, data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedBy: actor } });

  const rows = await prisma.shiftAssignment.findMany({
    where: { businessDay: { businessDate: range }, status: { in: ['CONFIRMED', 'CANCELLED', 'ABSENT'] } },
    include: { businessDay: true, staff: true },
    orderBy: { plannedStart: 'asc' },
  });

  const byStaff = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byStaff.get(row.staffId) ?? [];
    list.push(row);
    byStaff.set(row.staffId, list);
  }

  const periodLabel = `${businessDateLabel(period.start, true)}〜${businessDateLabel(period.end)}`;
  let notified = 0;
  for (const [, list] of byStaff) {
    const staff = list[0]!.staff;
    const changed = list.filter((a) => assignmentSignature(a) !== a.notifiedSignature);
    if (changed.length === 0) continue;
    const isUpdate = list.some((a) => a.notifiedAt !== null);
    if (staff.lineUserId) {
      await enqueueLinePush(
        staff.lineUserId,
        [
          confirmedShiftMessage(
            staff.name,
            periodLabel,
            list
              .filter((a) => a.status !== 'ABSENT')
              .map((a) => ({
                businessDate: dbValueToBusinessDate(a.businessDay.businessDate),
                role: a.roleAssigned as StaffRole,
                start: a.plannedStart,
                end: a.plannedEnd,
                status: a.status as 'CONFIRMED' | 'CANCELLED',
              })),
            isUpdate,
          ),
        ],
        { kind: 'SHIFT_CONFIRMED', ref: periodId },
      );
      notified++;
    }
    const now = new Date();
    for (const a of list) {
      await prisma.shiftAssignment.update({ where: { id: a.id }, data: { notifiedSignature: assignmentSignature(a), notifiedAt: now } });
    }
  }
  await prisma.auditLog.create({
    data: { actorName: actor, action: 'period.confirm', targetType: 'ShiftPeriod', targetId: periodId, detail: { confirmed: confirmedResult.count, notified } },
  });
  return { confirmed: confirmedResult.count, notified };
}
