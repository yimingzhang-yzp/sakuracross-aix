import { dbValueToBusinessDate } from '@sakura-cross/business-date';
import iconv from 'iconv-lite';
import { NextResponse } from 'next/server';

import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { buildPayrollCsv } from '@/lib/payroll/csv';
import type { PayrollItemDraft } from '@/lib/payroll/types';
import { parseSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') return new NextResponse('Unauthorized', { status: 401 });

  const { id } = await context.params;
  const run = await db().payrollRun.findUnique({ where: { id }, include: { items: { include: { staff: true }, orderBy: { staff: { name: 'asc' } } } } });
  if (!run) return new NextResponse('Not found', { status: 404 });

  const period = { start: dbValueToBusinessDate(run.periodStart), end: dbValueToBusinessDate(run.periodEnd) };
  const items: PayrollItemDraft[] = run.items.map((i) => ({
    staffId: i.staffId,
    staffName: i.staff.name,
    employmentType: i.staff.employmentType,
    monthlySalary: i.monthlySalary,
    totalMinutes: i.totalMinutes,
    nightMinutes: i.nightMinutes,
    basePay: i.basePay,
    nightPremiumPay: i.nightPremiumPay,
    incentivePay: i.incentivePay,
    advanceDeduction: i.advanceDeduction,
    grossPay: i.grossPay,
    healthInsurance: i.healthInsurance,
    careInsurance: i.careInsurance,
    pensionInsurance: i.pensionInsurance,
    employmentInsurance: i.employmentInsurance,
    incomeTax: i.incomeTax,
    standardMonthlyRemuneration: i.standardMonthlyRemuneration,
    taxableIncome: i.taxableIncome,
    totalDeductions: i.healthInsurance + i.careInsurance + i.pensionInsurance + i.employmentInsurance + i.incomeTax,
    netPay: i.netPay,
    breakdown: [],
    incentives: [],
    advances: [],
    warnings: i.warnings,
  }));
  const csv = buildPayrollCsv(period, items);
  const settings = parseSettings(run.settingsSnapshot);
  const filename = `payroll_${period.start}_${period.end}${run.status === 'FINALIZED' ? '' : '_draft'}.csv`;

  let body: Uint8Array;
  let contentType: string;
  if (settings.csvEncoding === 'sjis') {
    body = iconv.encode(csv, 'Shift_JIS');
    contentType = 'text/csv; charset=Shift_JIS';
  } else {
    body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, 'utf8')]);
    contentType = 'text/csv; charset=utf-8';
  }
  await db().auditLog.create({ data: { actorId: session.userId, actorName: session.name, action: 'payroll.csv', targetType: 'PayrollRun', targetId: id } });
  return new NextResponse(body as unknown as BodyInit, {
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
