/**
 * 給与 CSV(会計・給与ソフト取込用の汎用フォーマット)
 * 列: スタッフ名, 雇用形態, 総労働時間, 深夜時間, 基本給, 深夜割増, インセンティブ, 総支給,
 *     健康保険, 介護保険, 厚生年金, 雇用保険, 所得税, 控除合計, 控除(日払い), 差引支給
 * 文字コードは設定(UTF-8 BOM / Shift_JIS)。
 */
import type { PayrollItemDraft, PayrollPeriod } from './types';

export const PAYROLL_CSV_HEADERS = [
  'スタッフ名',
  '雇用形態',
  '総労働時間',
  '深夜時間',
  '基本給',
  '深夜割増',
  'インセンティブ',
  '総支給',
  '健康保険',
  '介護保険',
  '厚生年金',
  '雇用保険',
  '所得税',
  '控除合計',
  '控除(日払い)',
  '差引支給',
] as const;

const EMPLOYMENT_LABEL: Record<PayrollItemDraft['employmentType'], string> = {
  PART_TIME: 'アルバイト',
  FULL_TIME: '社員',
  CONTRACT: '契約',
};

export function formatMinutesAsHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function escapeCsv(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildPayrollCsv(period: PayrollPeriod, items: PayrollItemDraft[]): string {
  const lines: string[] = [];
  lines.push(PAYROLL_CSV_HEADERS.map(escapeCsv).join(','));
  for (const item of items) {
    lines.push(
      [
        item.staffName,
        EMPLOYMENT_LABEL[item.employmentType],
        formatMinutesAsHours(item.totalMinutes),
        formatMinutesAsHours(item.nightMinutes),
        item.basePay,
        item.nightPremiumPay,
        item.incentivePay,
        item.grossPay,
        item.healthInsurance,
        item.careInsurance,
        item.pensionInsurance,
        item.employmentInsurance,
        item.incomeTax,
        item.totalDeductions,
        item.advanceDeduction,
        item.netPay,
      ]
        .map(escapeCsv)
        .join(','),
    );
  }
  lines.push('');
  lines.push(escapeCsv(`# 対象期間 ${period.start}〜${period.end}`));
  lines.push(escapeCsv('# 社会保険料・雇用保険料は設定の料率、所得税は電算機計算の特例(甲欄)で算出。住民税は含みません'));
  return lines.join('\r\n') + '\r\n';
}
