/**
 * 給与計算の入出力型。DB(Prisma)の型に依存しない純粋なデータ構造にし、
 * ロジックを純関数としてテスト可能にする。
 */
import type { ShiftPayrollSettings } from '../settings';

export type EmploymentType = 'PART_TIME' | 'FULL_TIME' | 'CONTRACT';

export interface PayrollStaffInput {
  id: string;
  name: string;
  employmentType: EmploymentType;
  /** Staff.hourlyWage(現在値のキャッシュ)。WageHistory が無いときのフォールバックにのみ使う */
  hourlyWage: number;
  monthlySalary: number | null;
  // --- 法定控除の属性(省略時は「甲欄・扶養 0・社保/雇用保険なし」) ---
  /** KOU(甲欄) / OTSU(乙欄) / NONE(源泉徴収しない) */
  taxTableType?: 'KOU' | 'OTSU' | 'NONE' | string;
  dependentsCount?: number;
  socialInsuranceEnrolled?: boolean;
  careInsuranceApplicable?: boolean;
  employmentInsuranceEnrolled?: boolean;
  /** 標準報酬月額。未設定なら当月総支給から推定 */
  standardMonthlyRemuneration?: number | null;
  /** 源泉所得税の固定額(乙欄などで手入力する場合) */
  fixedIncomeTax?: number | null;
}

export interface TimeRecordInput {
  id: string;
  staffId: string;
  /** YYYY-MM-DD(営業日) */
  businessDate: string;
  clockIn: Date | null;
  clockOut: Date | null;
  /** 手入力の休憩分数。0 なら自動控除の対象 */
  breakMinutes: number;
  approved: boolean;
}

export interface WageHistoryInput {
  staffId: string;
  hourlyWage: number;
  /** YYYY-MM-DD。この日以降の勤務に適用 */
  effectiveFrom: string;
}

export interface IncentiveInput {
  staffId: string;
  businessDate: string;
  kind: string;
  amount: number;
}

export interface AdvancePaymentInput {
  staffId: string;
  businessDate: string;
  amount: number;
  memo?: string | null;
}

/** 給与期間(営業日、両端含む) */
export interface PayrollPeriod {
  start: string;
  end: string;
}

export interface DailyBreakdown {
  businessDate: string;
  clockIn: string | null;
  clockOut: string | null;
  roundedClockIn: string | null;
  roundedClockOut: string | null;
  /** 丸め後の在店分数(休憩控除前) */
  rawMinutes: number;
  breakMinutes: number;
  /** 休憩を自動控除した(手入力が無かった) */
  autoBreakApplied: boolean;
  /** 労働分数 = rawMinutes − breakMinutes */
  totalMinutes: number;
  /** 深夜時間帯(既定 22:00〜翌5:00)に含まれる労働分数 */
  nightMinutes: number;
  /** 適用時給。月給者は 0 */
  hourlyWage: number;
  wageSource: 'history' | 'staff_fallback' | 'monthly';
  basePay: number;
  nightPremiumPay: number;
  warnings: string[];
}

export interface PayrollItemDraft {
  staffId: string;
  staffName: string;
  employmentType: EmploymentType;
  monthlySalary: number | null;
  totalMinutes: number;
  nightMinutes: number;
  basePay: number;
  nightPremiumPay: number;
  incentivePay: number;
  advanceDeduction: number;
  /** 総支給 = 基本給 + 深夜割増 + インセンティブ */
  grossPay: number;
  /** 健康保険料(本人負担) */
  healthInsurance: number;
  /** 介護保険料(本人負担。40〜64歳のみ) */
  careInsurance: number;
  /** 厚生年金保険料(本人負担) */
  pensionInsurance: number;
  /** 雇用保険料(本人負担) */
  employmentInsurance: number;
  /** 源泉所得税 */
  incomeTax: number;
  /** 計算に使った標準報酬月額(社保未加入は null) */
  standardMonthlyRemuneration: number | null;
  /** 課税対象額 = 総支給 − 社会保険料等 */
  taxableIncome: number;
  /** 法定控除の合計 = 社会保険料 + 雇用保険料 + 所得税(日払いは含まない) */
  totalDeductions: number;
  /** 差引支給 = 総支給 − 法定控除 − 日払い */
  netPay: number;
  breakdown: DailyBreakdown[];
  incentives: IncentiveInput[];
  advances: AdvancePaymentInput[];
  warnings: string[];
}

export interface PayrollResult {
  period: PayrollPeriod;
  items: PayrollItemDraft[];
  /** 全体の警告(未承認打刻の件数など) */
  warnings: string[];
  settings: ShiftPayrollSettings;
}

export interface ComputePayrollInput {
  period: PayrollPeriod;
  staff: PayrollStaffInput[];
  timeRecords: TimeRecordInput[];
  wageHistories: WageHistoryInput[];
  incentives: IncentiveInput[];
  advancePayments: AdvancePaymentInput[];
  settings: ShiftPayrollSettings;
}
