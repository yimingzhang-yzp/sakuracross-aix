/**
 * 法定控除(社会保険料・雇用保険料・源泉所得税)の計算(純関数)
 *
 * 計算順序は給与実務の標準に合わせる:
 *   1. 健康保険・介護保険・厚生年金 … 標準報酬月額 × 料率 ÷ 2(被保険者負担分)
 *   2. 雇用保険 … 総支給 × 被保険者負担率
 *   3. 源泉所得税 … 課税対象額 A = 総支給 − (1 + 2) に対して電算機計算の特例(甲欄)
 *   差引支給 = 総支給 − (1 + 2 + 3) − 日払い
 *
 * 被保険者負担分の端数は「50 銭以下切り捨て・50 銭超切り上げ」(五捨六入)。
 * 所得税は 10 円未満を四捨五入(特例の定め)。
 */
import type { ShiftPayrollSettings } from '../settings';
import {
  HEALTH_INSURANCE_GRADES,
  type IncomeTaxMonthlyTable,
  type LinearTable,
  OTSU_UNDER_88K_LIMIT,
  OTSU_UNDER_88K_RATE,
  PENSION_GRADE_MAX,
  PENSION_GRADE_MIN,
  type StepTable,
  incomeTaxTableFor,
} from './tax-tables';

export type TaxTableType = 'KOU' | 'OTSU' | 'NONE';

export const TAX_TABLE_TYPES: TaxTableType[] = ['KOU', 'OTSU', 'NONE'];

export const TAX_TABLE_LABELS: Record<TaxTableType, string> = {
  KOU: '甲欄(扶養控除等申告書あり)',
  OTSU: '乙欄(申告書なし・副業)',
  NONE: '源泉徴収しない',
};

/** 控除計算に必要なスタッフ属性(Staff テーブルの対応カラム) */
export interface DeductionStaffInput {
  taxTableType?: TaxTableType | string | null;
  dependentsCount?: number | null;
  socialInsuranceEnrolled?: boolean | null;
  careInsuranceApplicable?: boolean | null;
  employmentInsuranceEnrolled?: boolean | null;
  standardMonthlyRemuneration?: number | null;
  fixedIncomeTax?: number | null;
}

export type DeductionSettings = Pick<
  ShiftPayrollSettings,
  'healthInsuranceRate' | 'careInsuranceRate' | 'pensionInsuranceRate' | 'employmentInsuranceWorkerRate'
>;

export interface DeductionResult {
  healthInsurance: number;
  careInsurance: number;
  pensionInsurance: number;
  employmentInsurance: number;
  /** 健保 + 介護 + 厚年 + 雇用 */
  socialInsuranceTotal: number;
  incomeTax: number;
  /** 計算に使った標準報酬月額(社保未加入は null) */
  standardMonthlyRemuneration: number | null;
  /** 課税対象額 A = 総支給 − 社会保険料等 */
  taxableIncome: number;
  /** 控除合計 = socialInsuranceTotal + incomeTax */
  totalDeductions: number;
  warnings: string[];
}

// -----------------------------------------------------------------------------
// 端数
// -----------------------------------------------------------------------------

/** 被保険者負担分の端数処理: 50 銭以下は切り捨て、50 銭超は切り上げ */
export function roundInsurance(value: number): number {
  const floor = Math.floor(value);
  const frac = value - floor;
  return frac > 0.5 + 1e-9 ? floor + 1 : floor;
}

/** 所得税の端数処理: 10 円未満を四捨五入 */
export function roundTax(value: number): number {
  return Math.round(value / 10) * 10;
}

// -----------------------------------------------------------------------------
// 標準報酬月額
// -----------------------------------------------------------------------------

/** 「amount < 上限」で最初に当たる帯の値(等級表用) */
function lookupStepExclusive(table: StepTable, amount: number): number {
  for (const [upper, value] of table) {
    if (amount < upper) return value;
  }
  return table[table.length - 1]![1];
}

/** 「amount <= 上限」で最初に当たる帯の値(基礎控除用) */
function lookupStepInclusive(table: StepTable, amount: number): number {
  for (const [upper, value] of table) {
    if (amount <= upper) return value;
  }
  return table[table.length - 1]![1];
}

/** 報酬月額 → 健康保険の標準報酬月額 */
export function healthStandardRemuneration(monthlyPay: number): number {
  return lookupStepExclusive(HEALTH_INSURANCE_GRADES, Math.max(0, monthlyPay));
}

/** 報酬月額 → 厚生年金の標準報酬月額(健保の等級を 88,000〜650,000 に丸める) */
export function pensionStandardRemuneration(monthlyPay: number): number {
  const health = healthStandardRemuneration(monthlyPay);
  return Math.min(PENSION_GRADE_MAX, Math.max(PENSION_GRADE_MIN, health));
}

// -----------------------------------------------------------------------------
// 源泉所得税(甲欄・電算機計算の特例)
// -----------------------------------------------------------------------------

function applyLinear(table: LinearTable, amount: number): number {
  for (const [upper, rate, offset] of table) {
    if (amount <= upper) return amount * rate + offset;
  }
  const last = table[table.length - 1]!;
  return amount * last[1] + last[2];
}

/**
 * 甲欄の月額源泉所得税。
 * @param taxableIncome 社会保険料等控除後の給与等の金額(A)
 */
export function computeIncomeTaxKou(taxableIncome: number, dependents: number, table: IncomeTaxMonthlyTable): number {
  const a = Math.max(0, Math.floor(taxableIncome));
  const employmentDeduction = Math.floor(applyLinear(table.employmentIncomeDeduction, a));
  const basic = lookupStepInclusive(table.basicDeduction, a);
  const dependentDeduction = Math.max(0, Math.floor(dependents)) * table.dependentDeductionPerPerson;
  const b = a - employmentDeduction - basic - dependentDeduction;
  if (b <= 0) return 0;
  // 別表第四の税額(復興特別所得税込み)
  return roundTax(Math.max(0, applyLinear(table.tax, b)));
}

/**
 * 乙欄の月額源泉所得税。88,000 円未満は A × 3.063%(円未満切り捨て)。
 * 88,000 円以上は計算式が公表されていないため null を返し、呼び出し側で手入力を促す。
 */
export function computeIncomeTaxOtsu(taxableIncome: number): number | null {
  const a = Math.max(0, Math.floor(taxableIncome));
  if (a < OTSU_UNDER_88K_LIMIT) return Math.floor(a * OTSU_UNDER_88K_RATE);
  return null;
}

// -----------------------------------------------------------------------------
// 全体
// -----------------------------------------------------------------------------

export function computeDeductions(input: {
  grossPay: number;
  staff: DeductionStaffInput;
  settings: DeductionSettings;
  /** 給与期間の終了日が属する年(所得税の表の切り替えに使う) */
  year: number;
}): DeductionResult {
  const { grossPay, staff, settings } = input;
  const warnings: string[] = [];

  // 1. 社会保険(健保・介護・厚年)
  let healthInsurance = 0;
  let careInsurance = 0;
  let pensionInsurance = 0;
  let standardMonthlyRemuneration: number | null = null;
  if (staff.socialInsuranceEnrolled) {
    if (staff.standardMonthlyRemuneration && staff.standardMonthlyRemuneration > 0) {
      standardMonthlyRemuneration = staff.standardMonthlyRemuneration;
    } else {
      standardMonthlyRemuneration = healthStandardRemuneration(grossPay);
      warnings.push(`標準報酬月額が未設定のため当月総支給(${grossPay.toLocaleString('ja-JP')}円)から ${standardMonthlyRemuneration.toLocaleString('ja-JP')} 円と推定`);
    }
    healthInsurance = roundInsurance((standardMonthlyRemuneration * settings.healthInsuranceRate) / 2);
    if (staff.careInsuranceApplicable) {
      careInsurance = roundInsurance((standardMonthlyRemuneration * settings.careInsuranceRate) / 2);
    }
    const pensionBase = Math.min(PENSION_GRADE_MAX, Math.max(PENSION_GRADE_MIN, standardMonthlyRemuneration));
    pensionInsurance = roundInsurance((pensionBase * settings.pensionInsuranceRate) / 2);
  }

  // 2. 雇用保険
  const employmentInsurance = staff.employmentInsuranceEnrolled ? roundInsurance(grossPay * settings.employmentInsuranceWorkerRate) : 0;

  const socialInsuranceTotal = healthInsurance + careInsurance + pensionInsurance + employmentInsurance;

  // 3. 源泉所得税
  const taxableIncome = Math.max(0, grossPay - socialInsuranceTotal);
  let incomeTax = 0;
  const type = (staff.taxTableType ?? 'KOU') as TaxTableType;
  if (staff.fixedIncomeTax !== null && staff.fixedIncomeTax !== undefined) {
    incomeTax = Math.max(0, Math.floor(staff.fixedIncomeTax));
    warnings.push(`源泉所得税はスタッフ設定の固定額 ${incomeTax.toLocaleString('ja-JP')} 円を使用`);
  } else if (type === 'NONE') {
    incomeTax = 0;
  } else if (type === 'OTSU') {
    const otsu = computeIncomeTaxOtsu(taxableIncome);
    if (otsu === null) {
      incomeTax = 0;
      warnings.push(`乙欄で課税対象額が ${OTSU_UNDER_88K_LIMIT.toLocaleString('ja-JP')} 円以上のため自動計算できません。月額表(乙欄)の税額をスタッフ設定の「源泉所得税の固定額」に入力してください`);
    } else {
      incomeTax = otsu;
    }
  } else {
    incomeTax = computeIncomeTaxKou(taxableIncome, staff.dependentsCount ?? 0, incomeTaxTableFor(input.year));
  }

  return {
    healthInsurance,
    careInsurance,
    pensionInsurance,
    employmentInsurance,
    socialInsuranceTotal,
    incomeTax,
    standardMonthlyRemuneration,
    taxableIncome,
    totalDeductions: socialInsuranceTotal + incomeTax,
    warnings,
  };
}
