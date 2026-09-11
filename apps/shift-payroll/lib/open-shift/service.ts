/**
 * 欠員募集のユースケース(発行・配信・応募処理・承認)
 */
import { dbValueToBusinessDate } from '@sakura-cross/business-date';
import { getPrisma } from '@sakura-cross/shared-db';

import { loadSettings } from '../db';
import { enqueueLinePush, pushToStaff } from '../line/queue';
import {
  openShiftClosedMessage,
  openShiftFlexMessage,
  openShiftPendingApprovalMessage,
  openShiftResultMessage,
} from '../line/messages';
import { overlapsMinorNight, staffCanWorkRole } from '../scheduling/generate';
import type { StaffRole } from '../scheduling/types';
import { isMinorNow } from '../staff/minor';
import { type ApplyOutcome, applyToOpenShift } from './apply';
import { createPrismaOpenShiftRepository } from './prisma-repo';

export interface IssueOpenShiftInput {
  businessDayId: string;
  role: StaffRole;
  start: Date;
  end: Date;
  reason: string;
  issuedBy: string;
}

/**
 * 募集を発行し、条件に合うスタッフ(職種適合・その日に確定シフトなし・希望が×でない・在籍・未成年制約)へ
 * Flex Message を即時配信する。
 */
export async function issueOpenShift(input: IssueOpenShiftInput): Promise<{ id: string; notified: number }> {
  const prisma = getPrisma();
  const settings = await loadSettings();
  const day = await prisma.businessDay.findUniqueOrThrow({ where: { id: input.businessDayId } });
  const businessDate = dbValueToBusinessDate(day.businessDate);

  const [staffList, assignedToday, preferences] = await Promise.all([
    prisma.staff.findMany({ where: { isActive: true } }),
    prisma.shiftAssignment.findMany({ where: { businessDayId: day.id, status: { in: ['CONFIRMED', 'DRAFT'] } }, select: { staffId: true } }),
    prisma.shiftPreference.findMany({ where: { businessDate: day.businessDate } }),
  ]);
  const busy = new Set(assignedToday.map((a) => a.staffId));
  const ng = new Set(preferences.filter((p) => p.availability === 'NG').map((p) => p.staffId));

  const eligible = staffList.filter(
    (s) =>
      staffCanWorkRole(s as never, input.role) &&
      !busy.has(s.id) &&
      !ng.has(s.id) &&
      !(isMinorNow(s) && overlapsMinorNight({ businessDate, start: input.start, end: input.end }, settings)) &&
      s.lineUserId,
  );

  const openShift = await prisma.openShiftRequest.create({
    data: {
      businessDayId: day.id,
      roleNeeded: input.role,
      start: input.start,
      end: input.end,
      reason: input.reason,
      mode: settings.openShiftMode,
      notifiedStaffIds: eligible.map((s) => s.id),
      expiresAt: settings.openShiftExpireHours > 0 ? new Date(Date.now() + settings.openShiftExpireHours * 3_600_000) : null,
    },
  });

  const message = openShiftFlexMessage({
    id: openShift.id,
    businessDate,
    role: input.role,
    start: input.start,
    end: input.end,
    hourlyWage: null,
    reason: input.reason,
    mode: settings.openShiftMode,
    eventName: day.eventName,
  });
  const notified = await pushToStaff(
    eligible.map((s) => s.id),
    [message],
    { kind: 'OPEN_SHIFT', ref: openShift.id },
  );
  await prisma.auditLog.create({
    data: { actorName: input.issuedBy, action: 'openShift.issue', targetType: 'OpenShiftRequest', targetId: openShift.id, detail: { notified, reason: input.reason } },
  });
  return { id: openShift.id, notified };
}

/**
 * LINE の Postback(shift:apply_open_shift)から呼ばれる応募処理。
 * 結果に応じて本人へ返信し、確定時は割当を作成して他の応募者・配信先へ締切を通知する。
 */
export async function handleOpenShiftApplication(
  openShiftId: string,
  lineUserId: string,
): Promise<{ outcome: ApplyOutcome | 'UNREGISTERED' | 'INELIGIBLE'; replyText: string }> {
  const prisma = getPrisma();
  const staff = await prisma.staff.findUnique({ where: { lineUserId } });
  if (!staff) return { outcome: 'UNREGISTERED', replyText: 'スタッフ登録が完了していないため応募できません。店長に確認してください。' };

  // 応募時点の再チェック: 同じ営業日に既にシフトがある / 在籍外 / 未成年の深夜スロット
  const target = await prisma.openShiftRequest.findUnique({ where: { id: openShiftId }, include: { businessDay: true } });
  if (target) {
    const settings = await loadSettings();
    const conflict = await prisma.shiftAssignment.findFirst({
      where: { staffId: staff.id, businessDayId: target.businessDayId, status: { in: ['DRAFT', 'CONFIRMED'] } },
    });
    if (conflict) return { outcome: 'INELIGIBLE', replyText: 'その営業日には既にシフトが入っているため応募できません。' };
    if (!staff.isActive) return { outcome: 'INELIGIBLE', replyText: '現在は応募できません。店長に確認してください。' };
    const bdate = dbValueToBusinessDate(target.businessDay.businessDate);
    if (isMinorNow(staff) && overlapsMinorNight({ businessDate: bdate, start: target.start, end: target.end }, settings)) {
      return { outcome: 'INELIGIBLE', replyText: '18歳未満のため 22 時以降のシフトには応募できません。' };
    }
  }

  const repo = createPrismaOpenShiftRepository(prisma);
  const outcome = await applyToOpenShift(repo, openShiftId, staff.id);
  const openShift = await prisma.openShiftRequest.findUnique({ where: { id: openShiftId }, include: { businessDay: true } });
  if (!openShift) return { outcome: 'NOT_FOUND', replyText: 'この募集は見つかりませんでした。' };
  const card = {
    businessDate: dbValueToBusinessDate(openShift.businessDay.businessDate),
    role: openShift.roleNeeded as StaffRole,
    start: openShift.start,
    end: openShift.end,
  };

  switch (outcome) {
    case 'WON': {
      await finalizeOpenShift(openShiftId, staff.id, 'first_come');
      return { outcome, replyText: textOf(openShiftResultMessage(true, card)) };
    }
    case 'LOST':
      return { outcome, replyText: textOf(openShiftResultMessage(false, card)) };
    case 'PENDING_APPROVAL':
      return { outcome, replyText: textOf(openShiftPendingApprovalMessage()) };
    case 'ALREADY_APPLIED':
      return { outcome, replyText: 'この募集にはすでに応募済みです。' };
    case 'CLOSED':
      return { outcome, replyText: textOf(openShiftClosedMessage(card)) };
    default:
      return { outcome, replyText: 'この募集は見つかりませんでした。' };
  }
}

function textOf(message: { type: string; text?: unknown }): string {
  return typeof message.text === 'string' ? message.text : '';
}

/**
 * 確定後処理: 割当作成(なければ)・落選者/配信先への通知。
 * 店長承認方式では管理画面から `approveOpenShiftApplication` 経由で呼ばれる。
 */
export async function finalizeOpenShift(openShiftId: string, winnerStaffId: string, via: 'first_come' | 'manager'): Promise<void> {
  const prisma = getPrisma();
  const openShift = await prisma.openShiftRequest.findUniqueOrThrow({ where: { id: openShiftId }, include: { businessDay: true, applications: true } });

  if (!openShift.assignmentId) {
    const assignment = await prisma.shiftAssignment.create({
      data: {
        staffId: winnerStaffId,
        businessDayId: openShift.businessDayId,
        roleAssigned: openShift.roleNeeded,
        plannedStart: openShift.start,
        plannedEnd: openShift.end,
        status: 'CONFIRMED',
        source: 'OPEN_SHIFT',
      },
    });
    await prisma.openShiftRequest.update({ where: { id: openShiftId }, data: { assignmentId: assignment.id, status: 'FILLED', filledByStaffId: winnerStaffId } });
  }

  const card = {
    businessDate: dbValueToBusinessDate(openShift.businessDay.businessDate),
    role: openShift.roleNeeded as StaffRole,
    start: openShift.start,
    end: openShift.end,
  };

  // 店長承認方式では勝者への確定通知もここで送る(先着方式は Postback の reply で済んでいる)
  if (via === 'manager') {
    await pushToStaff([winnerStaffId], [openShiftResultMessage(true, card)], { kind: 'OPEN_SHIFT_RESULT', ref: openShiftId });
  }

  const losers = openShift.applications.filter((a) => a.staffId !== winnerStaffId).map((a) => a.staffId);
  if (losers.length > 0) {
    await prisma.openShiftApplication.updateMany({ where: { openShiftRequestId: openShiftId, staffId: { in: losers } }, data: { status: 'LOST' } });
    await pushToStaff(losers, [openShiftResultMessage(false, card)], { kind: 'OPEN_SHIFT_RESULT', ref: openShiftId });
  }
  const applicants = new Set(openShift.applications.map((a) => a.staffId));
  const others = openShift.notifiedStaffIds.filter((id) => id !== winnerStaffId && !applicants.has(id));
  if (others.length > 0) {
    await pushToStaff(others, [openShiftClosedMessage(card)], { kind: 'OPEN_SHIFT_CLOSED', ref: openShiftId });
  }
}

/** 店長承認方式: 管理画面で応募者を選んで確定 */
export async function approveOpenShiftApplication(openShiftId: string, staffId: string, approvedBy: string): Promise<boolean> {
  const prisma = getPrisma();
  const repo = createPrismaOpenShiftRepository(prisma);
  const snapshot = await repo.get(openShiftId);
  if (!snapshot || snapshot.status !== 'OPEN') return false;
  const won = await repo.tryFill(openShiftId, staffId, snapshot.version);
  if (!won) return false;
  await repo.setApplicationStatus(openShiftId, staffId, 'WON');
  await finalizeOpenShift(openShiftId, staffId, 'manager');
  await prisma.auditLog.create({
    data: { actorName: approvedBy, action: 'openShift.approve', targetType: 'OpenShiftRequest', targetId: openShiftId, detail: { staffId } },
  });
  return true;
}

/** 募集を取り下げる(EXPIRED)。配信済みの相手へ締切通知 */
export async function closeOpenShift(openShiftId: string, closedBy: string): Promise<void> {
  const prisma = getPrisma();
  const openShift = await prisma.openShiftRequest.findUniqueOrThrow({ where: { id: openShiftId }, include: { businessDay: true } });
  if (openShift.status !== 'OPEN') return;
  await prisma.openShiftRequest.update({ where: { id: openShiftId }, data: { status: 'EXPIRED', version: { increment: 1 } } });
  const card = {
    businessDate: dbValueToBusinessDate(openShift.businessDay.businessDate),
    role: openShift.roleNeeded as StaffRole,
    start: openShift.start,
    end: openShift.end,
  };
  await pushToStaff(openShift.notifiedStaffIds, [openShiftClosedMessage(card)], { kind: 'OPEN_SHIFT_CLOSED', ref: openShiftId });
  await prisma.auditLog.create({ data: { actorName: closedBy, action: 'openShift.close', targetType: 'OpenShiftRequest', targetId: openShiftId } });
}

export { enqueueLinePush };
