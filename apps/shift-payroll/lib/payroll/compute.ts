/**
 * 給与計算ロジック(純関数)
 *
 * 指示書 01 §5.4 に対応:
 * - 打刻の丸め(既定なし。方向は労働者有利が既定)
 * - 休憩の自動控除(6h 超 45 分 / 8h 超 60 分。設定で変更可)
 * - 労働分数 = clockOut − clockIn − 休憩(承認済み TimeRecord のみ)
 * - 適用時給は WageHistory から勤務日時点の値を引く(Staff.hourlyWage は使わない)
 * - 深夜割増: 22:00〜翌5:00 の分数を分単位で判定し 25% を加算。日またぎ勤務に対応
 * - 総支給 = 基本給 + 深夜割増 + インセンティブ、差引支給 = 総支給 − 日払い
 * - 月給制社員は固定額のみ計上(深夜割増なし)
 */
import {
  addBusinessDays,
  businessDateTimeToDate,
  isBusinessDateString,
} from '@sakura-cross/business-date';

import type { ShiftPayrollSettings } from '../settings';
import type {
  AdvancePaymentInput,
  ComputePayrollInput,
  DailyBreakdown,
  IncentiveInput,
  PayrollItemDraft,
  PayrollPeriod,
  PayrollResult,
  PayrollStaffInput,
  TimeRecordInput,
  WageHistoryInput,
} from './types';

const MINUTE_MS = 60_000;

// -----------------------------------------------------------------------------
// 期間
// -----------------------------------------------------------------------------

/**
 * 締め日設定と対象年月から給与期間を求める。
 * - 'EOM': その月の 1 日〜末日
 * - N(1〜28): 前月 N+1 日〜当月 N 日
 */
export function getPayrollPeriod(closingDay: ShiftPayrollSettings['payrollClosingDay'], year: number, month: number): PayrollPeriod {
  const pad = (n: number) => String(n).padStart(2, '0');
  if (closingDay === 'EOM') {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(lastDay)}` };
  }
  const end = `${year}-${pad(month)}-${pad(closingDay)}`;
  const prev = new Date(Date.UTC(year, month - 2, closingDay + 1));
  const start = `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`;
  return { start, end };
}

export function isWithinPeriod(businessDate: string, period: PayrollPeriod): boolean {
  return businessDate >= period.start && businessDate <= period.end;
}

// -----------------------------------------------------------------------------
// 丸め
// -----------------------------------------------------------------------------

export type RoundingMode = ShiftPayrollSettings['roundingMode'];

/**
 * 打刻時刻を単位(分)で丸める。5/10/15/30 分単位は時差が「時」単位のタイムゾーンでは境界が一致するため、
 * エポックミリ秒の剰余で計算してよい(Asia/Tokyo は +09:00)。
 */
export function roundClock(date: Date, unitMinutes: number, mode: RoundingMode, kind: 'in' | 'out'): Date {
  if (unitMinutes <= 0) return new Date(date.getTime());
  const unit = unitMinutes * MINUTE_MS;
  const t = date.getTime();
  const floor = Math.floor(t / unit) * unit;
  const ceil = Math.ceil(t / unit) * unit;
  if (floor === ceil) return new Date(t);
  switch (mode) {
    case 'nearest':
      return new Date(t - floor < ceil - t ? floor : ceil);
    case 'strict':
      // 出勤は遅い方へ、退勤は早い方へ(労働者不利)
      return new Date(kind === 'in' ? ceil : floor);
    case 'favor_worker':
    default:
      // 出勤は早い方へ、退勤は遅い方へ(労働者有利)
      return new Date(kind === 'in' ? floor : ceil);
  }
}

// -----------------------------------------------------------------------------
// 休憩
// -----------------------------------------------------------------------------

/**
 * 実労働(在店)分数に対する自動控除分数。該当するルールのうち最大の控除を返す。
 */
export function computeAutoBreak(rawMinutes: number, rules: ShiftPayrollSettings['autoBreakRules']): number {
  let best = 0;
  for (const rule of rules) {
    if (rawMinutes > rule.overMinutes && rule.breakMinutes > best) {
      best = rule.breakMinutes;
    }
  }
  return best;
}

// -----------------------------------------------------------------------------
// 深夜時間帯
// -----------------------------------------------------------------------------

/**
 * 営業日に対応する深夜時間帯 [start, end) を返す。既定 [D 22:00, D+1 05:00) JST。
 */
export function nightWindowFor(businessDate: string, nightStart: string, nightEnd: string): { start: Date; end: Date } {
  const start = businessDateTimeToDate(businessDate, nightStart);
  let end = businessDateTimeToDate(businessDate, nightEnd);
  if (end <= start) {
    // nightEnd が nightStart より「営業日内で前」に来る設定(例 22:00→22:00)は翌日扱い
    end = businessDateTimeToDate(addBusinessDays(businessDate, 1), nightEnd);
  }
  return { start, end };
}

/** 2 区間の重なり(分)。分未満は切り捨て */
export function overlapMinutes(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return end > start ? Math.floor((end - start) / MINUTE_MS) : 0;
}

/**
 * 在店区間のうち深夜時間帯に含まれる分数。
 */
export function computeNightMinutes(
  start: Date,
  end: Date,
  businessDate: string,
  settings: Pick<ShiftPayrollSettings, 'nightStart' | 'nightEnd'>,
): number {
  const window = nightWindowFor(businessDate, settings.nightStart, settings.nightEnd);
  return overlapMinutes(start, end, window.start, window.end);
}

/**
 * 休憩を控除して (労働分数, 深夜労働分数) を求める。
 * 休憩は通常時間帯から先に控除し、足りない分だけ深夜から控除する(深夜割増を削らない安全側)。
 */
export function applyBreak(rawMinutes: number, rawNightMinutes: number, breakMinutes: number): { totalMinutes: number; nightMinutes: number } {
  const totalMinutes = Math.max(0, rawMinutes - breakMinutes);
  const normalMinutes = rawMinutes - rawNightMinutes;
  const breakFromNormal = Math.min(breakMinutes, normalMinutes);
  const breakFromNight = Math.max(0, breakMinutes - breakFromNormal);
  const nightMinutes = Math.max(0, rawNightMinutes - breakFromNight);
  return { totalMinutes, nightMinutes: Math.min(nightMinutes, totalMinutes) };
}

// -----------------------------------------------------------------------------
// 時給
// -----------------------------------------------------------------------------

/**
 * 勤務日(営業日)時点で有効な時給を WageHistory から解決する。
 * 履歴が無い場合は Staff.hourlyWage を使い、警告を返す。
 */
export function resolveHourlyWage(
  staff: PayrollStaffInput,
  histories: WageHistoryInput[],
  businessDate: string,
): { hourlyWage: number; source: 'history' | 'staff_fallback' } {
  let best: WageHistoryInput | undefined;
  for (const h of histories) {
    if (h.staffId !== staff.id) continue;
    if (h.effectiveFrom > businessDate) continue;
    if (!best || h.effectiveFrom > best.effectiveFrom) best = h;
  }
  if (best) return { hourlyWage: best.hourlyWage, source: 'history' };
  return { hourlyWage: staff.hourlyWage, source: 'staff_fallback' };
}

// -----------------------------------------------------------------------------
// 金額の端数
// -----------------------------------------------------------------------------

function roundYenDaily(value: number, mode: ShiftPayrollSettings['yenRounding']): number {
  switch (mode) {
    case 'round_daily':
      return Math.round(value);
    case 'floor_daily':
      return Math.floor(value);
    case 'floor_monthly':
    default:
      return value; // 月合計で丸める
  }
}

/** 月合計の丸め。日別に丸めるモードでは既に整数なので実質 no-op */
function roundYenMonthly(value: number, _mode: ShiftPayrollSettings['yenRounding']): number {
  return Math.floor(value + 1e-9);
}

// -----------------------------------------------------------------------------
// 日別計算
// -----------------------------------------------------------------------------

export function isMonthlySalaried(staff: PayrollStaffInput): boolean {
  return staff.employmentType === 'FULL_TIME' && staff.monthlySalary !== null && staff.monthlySalary !== undefined;
}

export function computeDaily(
  record: TimeRecordInput,
  staff: PayrollStaffInput,
  wageHistories: WageHistoryInput[],
  settings: ShiftPayrollSettings,
): DailyBreakdown {
  const warnings: string[] = [];
  const monthly = isMonthlySalaried(staff);
  const empty: DailyBreakdown = {
    businessDate: record.businessDate,
    clockIn: record.clockIn?.toISOString() ?? null,
    clockOut: record.clockOut?.toISOString() ?? null,
    roundedClockIn: null,
    roundedClockOut: null,
    rawMinutes: 0,
    breakMinutes: 0,
    autoBreakApplied: false,
    totalMinutes: 0,
    nightMinutes: 0,
    hourlyWage: 0,
    wageSource: monthly ? 'monthly' : 'staff_fallback',
    basePay: 0,
    nightPremiumPay: 0,
    warnings,
  };

  if (!record.clockIn || !record.clockOut) {
    warnings.push(`${record.businessDate}: 打刻が不完全(出勤または退勤なし)のため除外`);
    return empty;
  }

  const roundedIn = roundClock(record.clockIn, settings.roundingMinutes, settings.roundingMode, 'in');
  const roundedOut = roundClock(record.clockOut, settings.roundingMinutes, settings.roundingMode, 'out');
  if (roundedOut <= roundedIn) {
    warnings.push(`${record.businessDate}: 退勤が出勤より前のため除外`);
    return { ...empty, roundedClockIn: roundedIn.toISOString(), roundedClockOut: roundedOut.toISOString() };
  }

  const rawMinutes = Math.floor((roundedOut.getTime() - roundedIn.getTime()) / MINUTE_MS);
  const rawNight = computeNightMinutes(roundedIn, roundedOut, record.businessDate, settings);

  let breakMinutes = record.breakMinutes;
  let autoBreakApplied = false;
  if (breakMinutes <= 0 && settings.autoBreakEnabled) {
    breakMinutes = computeAutoBreak(rawMinutes, settings.autoBreakRules);
    autoBreakApplied = breakMinutes > 0;
  }
  const { totalMinutes, nightMinutes } = applyBreak(rawMinutes, rawNight, breakMinutes);

  if (monthly) {
    return {
      ...empty,
      roundedClockIn: roundedIn.toISOString(),
      roundedClockOut: roundedOut.toISOString(),
      rawMinutes,
      breakMinutes,
      autoBreakApplied,
      totalMinutes,
      nightMinutes,
      hourlyWage: 0,
      wageSource: 'monthly',
    };
  }

  const wage = resolveHourlyWage(staff, wageHistories, record.businessDate);
  if (wage.source === 'staff_fallback') {
    warnings.push(`${record.businessDate}: 時給履歴が無いため Staff.hourlyWage(${staff.hourlyWage}円)を使用`);
  }
  const basePayRaw = (totalMinutes * wage.hourlyWage) / 60;
  const nightPremiumRaw = (nightMinutes * wage.hourlyWage * settings.nightPremiumRate) / 60;

  return {
    ...empty,
    roundedClockIn: roundedIn.toISOString(),
    roundedClockOut: roundedOut.toISOString(),
    rawMinutes,
    breakMinutes,
    autoBreakApplied,
    totalMinutes,
    nightMinutes,
    hourlyWage: wage.hourlyWage,
    wageSource: wage.source,
    basePay: roundYenDaily(basePayRaw, settings.yenRounding),
    nightPremiumPay: roundYenDaily(nightPremiumRaw, settings.yenRounding),
  };
}

// -----------------------------------------------------------------------------
// 全体
// -----------------------------------------------------------------------------

export function computePayroll(input: ComputePayrollInput): PayrollResult {
  const { period, settings } = input;
  if (!isBusinessDateString(period.start) || !isBusinessDateString(period.end) || period.start > period.end) {
    throw new TypeError(`給与期間が不正です: ${period.start}〜${period.end}`);
  }

  const globalWarnings: string[] = [];
  const items: PayrollItemDraft[] = [];

  const recordsInPeriod = input.timeRecords.filter((r) => isWithinPeriod(r.businessDate, period));
  const unapproved = recordsInPeriod.filter((r) => !r.approved);
  if (unapproved.length > 0) {
    globalWarnings.push(`未承認の打刻 ${unapproved.length} 件を計算から除外しました(勤怠画面で承認してください)`);
  }

  for (const staff of [...input.staff].sort((a, b) => a.name.localeCompare(b.name, 'ja'))) {
    const staffRecords = recordsInPeriod
      .filter((r) => r.staffId === staff.id && r.approved)
      .sort((a, b) => a.businessDate.localeCompare(b.businessDate));
    const incentives = input.incentives.filter((i) => i.staffId === staff.id && isWithinPeriod(i.businessDate, period));
    const advances = input.advancePayments.filter((a) => a.staffId === staff.id && isWithinPeriod(a.businessDate, period));
    const unapprovedCount = recordsInPeriod.filter((r) => r.staffId === staff.id && !r.approved).length;

    if (staffRecords.length === 0 && incentives.length === 0 && advances.length === 0 && !isMonthlySalaried(staff)) {
      continue; // 対象期間に何も無いスタッフは明細を作らない
    }

    const breakdown = staffRecords.map((r) => computeDaily(r, staff, input.wageHistories, settings));
    const warnings = breakdown.flatMap((d) => d.warnings);
    if (unapprovedCount > 0) warnings.unshift(`未承認の打刻 ${unapprovedCount} 件を除外`);

    const totalMinutes = sum(breakdown.map((d) => d.totalMinutes));
    const nightMinutes = sum(breakdown.map((d) => d.nightMinutes));
    const monthly = isMonthlySalaried(staff);

    let basePay: number;
    let nightPremiumPay: number;
    if (monthly) {
      basePay = staff.monthlySalary ?? 0;
      nightPremiumPay = 0;
    } else {
      basePay = roundYenMonthly(sum(breakdown.map((d) => d.basePay)), settings.yenRounding);
      nightPremiumPay = roundYenMonthly(sum(breakdown.map((d) => d.nightPremiumPay)), settings.yenRounding);
    }
    const incentivePay = sum(incentives.map((i) => i.amount));
    const advanceDeduction = sum(advances.map((a) => a.amount));
    const grossPay = basePay + nightPremiumPay + incentivePay;
    const netPay = grossPay - advanceDeduction;

    items.push({
      staffId: staff.id,
      staffName: staff.name,
      employmentType: staff.employmentType,
      monthlySalary: monthly ? staff.monthlySalary : null,
      totalMinutes,
      nightMinutes,
      basePay,
      nightPremiumPay,
      incentivePay,
      advanceDeduction,
      grossPay,
      netPay,
      breakdown,
      incentives,
      advances,
      warnings,
    });
  }

  return { period, items, warnings: globalWarnings, settings };
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

// -----------------------------------------------------------------------------
// 確定ロック
// -----------------------------------------------------------------------------

export interface FinalizedPeriod {
  id: string;
  periodStart: string;
  periodEnd: string;
}

export class PayrollLockedError extends Error {
  constructor(
    public readonly businessDate: string,
    public readonly runId: string,
  ) {
    super(
      `${businessDate} は確定済みの給与期間(PayrollRun ${runId})に含まれるため編集できません。修正が必要な場合は給与計算を再計算(新しいドラフト作成)してください。`,
    );
    this.name = 'PayrollLockedError';
  }
}

/** 営業日が確定済み期間に含まれるか */
export function findLockingRun(finalized: FinalizedPeriod[], businessDate: string): FinalizedPeriod | undefined {
  return finalized.find((run) => businessDate >= run.periodStart && businessDate <= run.periodEnd);
}

/** 確定済み期間なら例外(勤怠・日払い・歩合の編集前に呼ぶ) */
export function assertNotLocked(finalized: FinalizedPeriod[], businessDate: string): void {
  const run = findLockingRun(finalized, businessDate);
  if (run) throw new PayrollLockedError(businessDate, run.id);
}

export type { AdvancePaymentInput, IncentiveInput };
