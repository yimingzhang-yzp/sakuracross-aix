'use server';

import { businessDateTimeToDate, businessDateToDbValue, dbValueToBusinessDate, isBusinessDateString } from '@sakura-cross/business-date';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/auth/session';
import { audit, db } from '@/lib/db';
import { issueOpenShift } from '@/lib/open-shift/service';
import type { StaffRole } from '@/lib/scheduling/types';
import { checkPlacement, confirmPeriod, runGeneration } from '@/lib/shift/service';

type ActionResult = { ok: boolean; message?: string; warnings?: string[] };

function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

export async function createPeriodAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const periodStart = str(form, 'periodStart');
  const periodEnd = str(form, 'periodEnd');
  const deadlineDate = str(form, 'deadlineDate');
  const deadlineTime = str(form, 'deadlineTime') ?? '23:59';
  if (!periodStart || !periodEnd || !deadlineDate || !isBusinessDateString(periodStart) || !isBusinessDateString(periodEnd) || periodStart > periodEnd) {
    redirect(`/admin/periods?error=${encodeURIComponent('期間の日付を確認してください')}`);
  }
  const prisma = db();
  const overlap = await prisma.shiftPeriod.findFirst({
    where: { periodStart: { lte: businessDateToDbValue(periodEnd) }, periodEnd: { gte: businessDateToDbValue(periodStart) } },
  });
  if (overlap) redirect(`/admin/periods?error=${encodeURIComponent('既存の期間と重なっています')}`);

  // 締切は「その暦日の時刻」。営業日基準の 10:00 境界は使わず、通常のカレンダー時刻として扱う
  const deadline = deadlineTime >= '10:00' ? businessDateTimeToDate(deadlineDate, deadlineTime) : new Date(`${deadlineDate}T${deadlineTime}:00+09:00`);
  const period = await prisma.shiftPeriod.create({
    data: { periodStart: businessDateToDbValue(periodStart), periodEnd: businessDateToDbValue(periodEnd), preferenceDeadline: deadline, status: 'COLLECTING' },
  });
  await audit(session, 'period.create', 'ShiftPeriod', period.id, { periodStart, periodEnd });
  revalidatePath('/admin/periods');
  redirect(`/admin/periods/${period.id}?ok=${encodeURIComponent('期間を作成しました')}`);
}

export async function generateAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const periodId = str(form, 'periodId');
  if (!periodId) redirect('/admin/periods');
  const result = await runGeneration(periodId, session.name);
  revalidatePath(`/admin/periods/${periodId}`);
  redirect(
    `/admin/periods/${periodId}?ok=${encodeURIComponent(`自動生成しました: ${result.assigned} 件割当${result.shortages > 0 ? ` / ${result.shortages} 名不足(赤セル)` : ' / 不足なし'}`)}`,
  );
}

export async function confirmPeriodAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const periodId = str(form, 'periodId');
  if (!periodId) redirect('/admin/periods');
  const result = await confirmPeriod(periodId, session.name);
  revalidatePath(`/admin/periods/${periodId}`);
  redirect(`/admin/periods/${periodId}?ok=${encodeURIComponent(`確定しました(新規確定 ${result.confirmed} 件 / LINE 配信 ${result.notified} 名)`)}`);
}

export async function addAssignmentAction(input: { periodId: string; staffId: string; requirementId: string }): Promise<ActionResult> {
  const session = await requireAdmin();
  const check = await checkPlacement(input.staffId, input.requirementId);
  if (!check.ok) return { ok: false, message: check.errors.join(' / ') };
  const prisma = db();
  const req = await prisma.staffingRequirement.findUniqueOrThrow({ where: { id: input.requirementId } });
  const a = await prisma.shiftAssignment.create({
    data: {
      staffId: input.staffId,
      businessDayId: req.businessDayId,
      roleAssigned: req.roleNeeded,
      plannedStart: req.startTime,
      plannedEnd: req.endTime,
      status: 'DRAFT',
      source: 'MANUAL',
    },
  });
  await audit(session, 'assignment.add', 'ShiftAssignment', a.id, { staffId: input.staffId, requirementId: input.requirementId });
  revalidatePath(`/admin/periods/${input.periodId}`);
  return { ok: true, message: '追加しました(下書き)', warnings: check.warnings };
}

export async function moveAssignmentAction(input: { periodId: string; assignmentId: string; requirementId: string }): Promise<ActionResult> {
  const session = await requireAdmin();
  const prisma = db();
  const current = await prisma.shiftAssignment.findUnique({ where: { id: input.assignmentId } });
  if (!current) return { ok: false, message: '割当が見つかりません' };
  const check = await checkPlacement(current.staffId, input.requirementId, current.id);
  if (!check.ok) return { ok: false, message: check.errors.join(' / ') };
  const req = await prisma.staffingRequirement.findUniqueOrThrow({ where: { id: input.requirementId } });
  await prisma.shiftAssignment.update({
    where: { id: current.id },
    data: {
      businessDayId: req.businessDayId,
      roleAssigned: req.roleNeeded,
      plannedStart: req.startTime,
      plannedEnd: req.endTime,
      source: 'MANUAL',
      status: current.status === 'CONFIRMED' ? 'CONFIRMED' : 'DRAFT',
    },
  });
  await audit(session, 'assignment.move', 'ShiftAssignment', current.id, { requirementId: input.requirementId });
  revalidatePath(`/admin/periods/${input.periodId}`);
  return { ok: true, message: '移動しました', warnings: check.warnings };
}

export async function removeAssignmentAction(input: { periodId: string; assignmentId: string }): Promise<ActionResult> {
  const session = await requireAdmin();
  const prisma = db();
  const current = await prisma.shiftAssignment.findUnique({ where: { id: input.assignmentId } });
  if (!current) return { ok: false, message: '割当が見つかりません' };
  if (current.status === 'CONFIRMED') {
    // 確定済みは履歴を残すため CANCELLED にする(本人へは再確定時に差分通知される)
    await prisma.shiftAssignment.update({ where: { id: current.id }, data: { status: 'CANCELLED', source: 'MANUAL' } });
  } else {
    await prisma.shiftAssignment.delete({ where: { id: current.id } });
  }
  await audit(session, 'assignment.remove', 'ShiftAssignment', current.id, { previousStatus: current.status });
  revalidatePath(`/admin/periods/${input.periodId}`);
  return { ok: true, message: current.status === 'CONFIRMED' ? '取消にしました(再確定で本人に通知されます)' : '外しました' };
}

export async function markAbsentAction(input: { periodId: string; assignmentId: string; issueOpenShift: boolean }): Promise<ActionResult> {
  const session = await requireAdmin();
  const prisma = db();
  const current = await prisma.shiftAssignment.findUnique({ where: { id: input.assignmentId }, include: { staff: true } });
  if (!current) return { ok: false, message: '割当が見つかりません' };
  await prisma.shiftAssignment.update({ where: { id: current.id }, data: { status: 'ABSENT' } });
  await audit(session, 'assignment.absent', 'ShiftAssignment', current.id, { staffId: current.staffId });
  let message = `${current.staff.name} を欠勤にしました`;
  if (input.issueOpenShift) {
    const result = await issueOpenShift({
      businessDayId: current.businessDayId,
      role: current.roleAssigned as StaffRole,
      start: current.plannedStart,
      end: current.plannedEnd,
      reason: `当日欠勤(${current.staff.name})`,
      issuedBy: session.name,
    });
    message += `。欠員募集を ${result.notified} 名に配信しました`;
  }
  revalidatePath(`/admin/periods/${input.periodId}`);
  revalidatePath('/admin/open-shifts');
  return { ok: true, message };
}

export async function issueOpenShiftAction(input: { periodId: string; requirementId: string }): Promise<ActionResult> {
  const session = await requireAdmin();
  const prisma = db();
  const req = await prisma.staffingRequirement.findUnique({ where: { id: input.requirementId }, include: { businessDay: true } });
  if (!req) return { ok: false, message: '必要人員が見つかりません' };
  const result = await issueOpenShift({
    businessDayId: req.businessDayId,
    role: req.roleNeeded as StaffRole,
    start: req.startTime,
    end: req.endTime,
    reason: '生成時不足',
    issuedBy: session.name,
  });
  revalidatePath(`/admin/periods/${input.periodId}`);
  revalidatePath('/admin/open-shifts');
  return {
    ok: true,
    message: `${dbValueToBusinessDate(req.businessDay.businessDate)} の欠員募集を ${result.notified} 名に配信しました${result.notified === 0 ? '(条件に合う LINE 連携済みスタッフがいません)' : ''}`,
  };
}
