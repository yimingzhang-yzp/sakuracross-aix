/**
 * 営業日の種別(イベント種別)を曜日ルールから決める
 *
 * 設定の closedWeekdays(定休日)と weekendWeekdays(週末営業)から、
 * 一括作成時の既定のイベント種別を求める。定休日が週末営業より優先される
 * (例: 日曜が両方に含まれていれば「休業」。手動で営業にした場合は「週末営業」を提案する)。
 */
import type { ShiftPayrollSettings } from '../settings';

export type EventTypeValue = 'NORMAL' | 'WEEKEND' | 'BIG_EVENT' | 'RENTAL' | 'CLOSED';

/** 画面の並び順(通常 → 週末 → ビッグイベント → 貸切 → 休業) */
export const EVENT_TYPES: EventTypeValue[] = ['NORMAL', 'WEEKEND', 'BIG_EVENT', 'RENTAL', 'CLOSED'];

/** 一括作成のフォームで「曜日ルールで自動判定」を表す値 */
export const AUTO_EVENT_TYPE = 'AUTO';

export type DayTypeRules = Pick<ShiftPayrollSettings, 'closedWeekdays' | 'weekendWeekdays'>;

/** 営業日(YYYY-MM-DD)の曜日。0=日 … 6=土 */
export function weekdayOfBusinessDate(businessDate: string): number {
  return new Date(`${businessDate}T00:00:00Z`).getUTCDay();
}

/**
 * 曜日ルールから営業日の種別を提案する。
 * @param options.ignoreClosed 定休日でも営業する前提で種別を求める(手動で営業にする場合の提案用)
 */
export function suggestEventType(businessDate: string, rules: DayTypeRules, options: { ignoreClosed?: boolean } = {}): EventTypeValue {
  const dow = weekdayOfBusinessDate(businessDate);
  if (!options.ignoreClosed && rules.closedWeekdays.includes(dow)) return 'CLOSED';
  if (rules.weekendWeekdays.includes(dow)) return 'WEEKEND';
  return 'NORMAL';
}
