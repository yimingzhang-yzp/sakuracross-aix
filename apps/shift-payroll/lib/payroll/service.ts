/**
 * 給与計算のユースケース(DB からの入力組み立て・ドラフト作成・確定・明細配信)
 */
import { businessDateToDbValue, dbValueToBusinessDate } from '@sakura-cross/business-date';
import { type Prisma, getPrisma } from '@sakura-cross/shared-db';

import { loadSettings } from '../db';
import { businessDateLabel } from '../format';
import { payslipMessage } from '../line/messages';
import { enqueueLinePush } from '../line/queue';
import { computePayroll } from './compute';
import type { PayrollPeriod, PayrollResult } from './types';

export async function buildPayrollInput(period: PayrollPeriod) {
  const prisma = getPrisma();
  const settings = await loadSettings();
  const range = { gte: businessDateToDbValue(period.start), lte: businessDateToDbValue(period.end) };
  const [staff, timeRecords, wageHistories, incentives, advancePayments] = await Promise.all([
    prisma.staff.findMany({ where: { OR: [{ isActive: true }, { timeRecords: { some: { businessDate: range } } }] } }),
    prisma.timeRecord.findMany({ where: { businessDate: range } }),
    prisma.wageHistory.findMany(),
    prisma.incentive.findMany({ where: { businessDate: range } }),
    prisma.advancePayment.findMany({ where: { businessDate: range } }),
  ]);
  return {
    period,
    settings,
    staff: staff.map((s) => ({ id: s.id, name: s.name, employmentType: s.employmentType, hourlyWage: s.hourlyWage, monthlySalary: s.monthlySalary })),
    timeRecords: timeRecords.map((r) => ({
      id: r.id,
      staffId: r.staffId,
      businessDate: dbValueToBusinessDate(r.businessDate),
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      breakMinutes: r.breakMinutes,
      approved: r.approved,
    })),
    wageHistories: wageHistories.map((w) => ({ staffId: w.staffId, hourlyWage: w.hourlyWage, effectiveFrom: dbValueToBusinessDate(w.effectiveFrom) })),
    incentives: incentives.map((i) => ({ staffId: i.staffId, businessDate: dbValueToBusinessDate(i.businessDate), kind: i.kind, amount: i.amount })),
    advancePayments: advancePayments.map((a) => ({ staffId: a.staffId, businessDate: dbValueToBusinessDate(a.businessDate), amount: a.amount, memo: a.memo })),
  };
}

/** ドラフトを作成(既存の DRAFT があれば置き換える。FINALIZED は残す) */
export async function createPayrollDraft(period: PayrollPeriod, actor: string): Promise<{ runId: string; result: PayrollResult }> {
  const prisma = getPrisma();
  const input = await buildPayrollInput(period);
  const result = computePayroll(input);

  const run = await prisma.$transaction(async (tx) => {
    await tx.payrollRun.deleteMany({
      where: { status: 'DRAFT', periodStart: businessDateToDbValue(period.start), periodEnd: businessDateToDbValue(period.end) },
    });
    return tx.payrollRun.create({
      data: {
        periodStart: businessDateToDbValue(period.start),
        periodEnd: businessDateToDbValue(period.end),
        status: 'DRAFT',
        settingsSnapshot: input.settings as unknown as Prisma.InputJsonValue,
        warnings: result.warnings,
        createdBy: actor,
        items: {
          create: result.items.map((item) => ({
            staffId: item.staffId,
            totalMinutes: item.totalMinutes,
            nightMinutes: item.nightMinutes,
            basePay: item.basePay,
            nightPremiumPay: item.nightPremiumPay,
            incentivePay: item.incentivePay,
            advanceDeduction: item.advanceDeduction,
            grossPay: item.grossPay,
            netPay: item.netPay,
            monthlySalary: item.monthlySalary,
            warnings: item.warnings,
            breakdown: { days: item.breakdown, incentives: item.incentives, advances: item.advances } as unknown as Prisma.InputJsonValue,
          })),
        },
      },
    });
  });
  await prisma.auditLog.create({
    data: { actorName: actor, action: 'payroll.draft', targetType: 'PayrollRun', targetId: run.id, detail: { period, items: result.items.length } as unknown as Prisma.InputJsonValue },
  });
  return { runId: run.id, result };
}

/** 確定: 以降この期間の勤怠・日払い・歩合は編集不可。明細を LINE 配信する */
export async function finalizePayrollRun(runId: string, actor: string): Promise<{ notified: number }> {
  const prisma = getPrisma();
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { items: { include: { staff: true } } } });
  if (run.status === 'FINALIZED') return { notified: 0 };
  await prisma.payrollRun.update({ where: { id: runId }, data: { status: 'FINALIZED', finalizedAt: new Date(), finalizedBy: actor } });

  const periodLabel = `${businessDateLabel(dbValueToBusinessDate(run.periodStart), true)}〜${businessDateLabel(dbValueToBusinessDate(run.periodEnd))}`;
  let notified = 0;
  for (const item of run.items) {
    if (!item.staff.lineUserId) continue;
    await enqueueLinePush(item.staff.lineUserId, [payslipMessage(item.staff.name, periodLabel, item)], { kind: 'PAYSLIP', ref: runId });
    notified++;
  }
  await prisma.payrollRun.update({ where: { id: runId }, data: { payslipsSentAt: new Date() } });
  await prisma.auditLog.create({ data: { actorName: actor, action: 'payroll.finalize', targetType: 'PayrollRun', targetId: runId, detail: { notified } } });
  return { notified };
}
