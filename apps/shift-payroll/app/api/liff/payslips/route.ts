import { dbValueToBusinessDate } from '@sakura-cross/business-date';
import { getPrisma } from '@sakura-cross/shared-db';

import { identifyLiffRequest, resolveStaff, unauthorized } from '@/lib/liff/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const identity = await identifyLiffRequest(request);
  if (!identity) return unauthorized();
  const staff = await resolveStaff(identity);
  if (!staff) return Response.json({ error: 'unregistered' }, { status: 403 });

  const items = await getPrisma().payrollItem.findMany({
    where: { staffId: staff.id, payrollRun: { status: 'FINALIZED' } },
    include: { payrollRun: true },
    orderBy: { payrollRun: { periodStart: 'desc' } },
    take: 12,
  });
  return Response.json({
    payslips: items.map((i) => ({
      id: i.id,
      periodStart: dbValueToBusinessDate(i.payrollRun.periodStart),
      periodEnd: dbValueToBusinessDate(i.payrollRun.periodEnd),
      finalizedAt: i.payrollRun.finalizedAt?.toISOString() ?? null,
      totalMinutes: i.totalMinutes,
      nightMinutes: i.nightMinutes,
      basePay: i.basePay,
      nightPremiumPay: i.nightPremiumPay,
      incentivePay: i.incentivePay,
      grossPay: i.grossPay,
      advanceDeduction: i.advanceDeduction,
      netPay: i.netPay,
      monthlySalary: i.monthlySalary,
      breakdown: i.breakdown,
    })),
  });
}
