/**
 * 給与 CSV(会計・給与ソフト取込用の汎用フォーマット)
 * 列: スタッフ名, 雇用形態, 総労働時間, 深夜時間, 基本給, 深夜割増, インセンティブ, 総支給, 控除(日払い), 差引支給
 * 文字コードは設定(UTF-8 BOM / Shift_JIS)。所得税・社会保険は計算しない旨を末尾に注記する。
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
        item.advanceDeduction,
        item.netPay,
      ]
        .map(escapeCsv)
        .join(','),
    );
  }
  lines.push('');
  lines.push(escapeCsv(`# 対象期間 ${period.start}〜${period.end}`));
  lines.push(escapeCsv('# 所得税・社会保険・雇用保険の控除は含みません(給与ソフト/社労士側で計算してください)'));
  return lines.join('\r\n') + '\r\n';
}
