/**
 * 営業日(business date)ユーティリティ
 *
 * CROSS ROPPONGI の1営業日は 20:00〜翌朝10:00 をひとまとまりとして扱う。
 *   businessDate = (timestamp - 10時間) の Asia/Tokyo における日付部分
 *
 * 例: 1月10日 22:00 の勤務も 1月11日 04:00 の勤務も「1月10日営業日」。
 *
 * すべての計算は UTC エポックと明示的なタイムゾーン指定(Asia/Tokyo)で行い、
 * 実行サーバーのローカルタイムゾーン(process.env.TZ)には一切依存しない。
 */
import { addDays as addCalendarDays, isValid } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

/** 業務上のタイムゾーン。全システムで固定 */
export const BUSINESS_TIMEZONE = 'Asia/Tokyo' as const;

/** 営業日の境界時刻(JST)。この時刻より前は前日の営業日に属する */
export const BUSINESS_DAY_BOUNDARY_HOUR = 10 as const;

/** 営業日算出のためのオフセット(ミリ秒)。timestamp からこの分を引いた日付が営業日 */
export const BUSINESS_DAY_OFFSET_MS = BUSINESS_DAY_BOUNDARY_HOUR * 60 * 60 * 1000;

/** `YYYY-MM-DD` 形式の営業日文字列 */
export type BusinessDateString = string;

/** 受け付ける時刻入力。文字列は ISO 8601(オフセット付き推奨) */
export type DateInput = Date | number | string;

const BUSINESS_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 入力を Date に正規化する。不正な値は例外にする(黙って Invalid Date を返さない)。
 */
export function toDate(input: DateInput): Date {
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (!isValid(date)) {
    throw new TypeError(`不正な日時です: ${String(input)}`);
  }
  return date;
}

/**
 * 営業日文字列の形式・実在性を検証する。
 */
export function isBusinessDateString(value: unknown): value is BusinessDateString {
  if (typeof value !== 'string') return false;
  const match = BUSINESS_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return (
    isValid(date) &&
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d)
  );
}

function assertBusinessDateString(value: string): asserts value is BusinessDateString {
  if (!isBusinessDateString(value)) {
    throw new TypeError(`営業日は YYYY-MM-DD 形式で指定してください: ${value}`);
  }
}

/**
 * 時刻 → 営業日(`YYYY-MM-DD`)。
 *
 * - 2025-01-10 20:00 JST → "2025-01-10"
 * - 2025-01-11 09:59 JST → "2025-01-10"
 * - 2025-01-11 10:00 JST → "2025-01-11"
 */
export function toBusinessDate(input: DateInput = new Date()): BusinessDateString {
  const date = toDate(input);
  const shifted = new Date(date.getTime() - BUSINESS_DAY_OFFSET_MS);
  return formatInTimeZone(shifted, BUSINESS_TIMEZONE, 'yyyy-MM-dd');
}

/**
 * 現在時刻の営業日。テスト容易性のため `now` を差し替え可能にしている。
 */
export function currentBusinessDate(now: DateInput = new Date()): BusinessDateString {
  return toBusinessDate(now);
}

/**
 * 営業日文字列 → Prisma の `@db.Date` カラムに保存するための Date。
 * Prisma は DateTime の UTC 日付部分を DATE として保存するため、UTC 深夜 0 時の Date を返す。
 */
export function businessDateToDbValue(businessDate: BusinessDateString): Date {
  assertBusinessDateString(businessDate);
  return new Date(`${businessDate}T00:00:00.000Z`);
}

/**
 * 時刻 → `@db.Date` 保存用の営業日 Date。`businessDateToDbValue(toBusinessDate(x))` の短縮。
 */
export function toBusinessDateDbValue(input: DateInput = new Date()): Date {
  return businessDateToDbValue(toBusinessDate(input));
}

/**
 * Prisma の `@db.Date` から取り出した Date(UTC 深夜 0 時)→ 営業日文字列。
 * `@db.Date` の値はカレンダー日付そのものなので、営業日オフセットは適用しない。
 */
export function dbValueToBusinessDate(value: Date): BusinessDateString {
  const date = toDate(value);
  return formatInTimeZone(date, 'UTC', 'yyyy-MM-dd');
}

/**
 * 営業日が指す時間範囲 [start, end) を返す。
 * start = その日の 10:00 JST、end = 翌日の 10:00 JST(排他的)。
 * 実際の営業(20:00〜翌5:00)はこの範囲に完全に含まれる。
 */
export function getBusinessDateRange(businessDate: BusinessDateString): { start: Date; end: Date } {
  assertBusinessDateString(businessDate);
  const start = fromZonedTime(`${businessDate}T10:00:00`, BUSINESS_TIMEZONE);
  const nextDate = addBusinessDays(businessDate, 1);
  const end = fromZonedTime(`${nextDate}T10:00:00`, BUSINESS_TIMEZONE);
  return { start, end };
}

/**
 * 時刻が指定営業日に属するか。
 */
export function isInBusinessDate(input: DateInput, businessDate: BusinessDateString): boolean {
  assertBusinessDateString(businessDate);
  return toBusinessDate(input) === businessDate;
}

/**
 * 営業日の加減算(暦日ベース)。
 */
export function addBusinessDays(businessDate: BusinessDateString, days: number): BusinessDateString {
  assertBusinessDateString(businessDate);
  const base = new Date(`${businessDate}T00:00:00.000Z`);
  const moved = addCalendarDays(base, days);
  return formatInTimeZone(moved, 'UTC', 'yyyy-MM-dd');
}

/**
 * 2つの営業日の差(days = b - a)。
 */
export function diffBusinessDays(a: BusinessDateString, b: BusinessDateString): number {
  assertBusinessDateString(a);
  assertBusinessDateString(b);
  const ms = businessDateToDbValue(b).getTime() - businessDateToDbValue(a).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * 営業日 + JST の壁時計時刻 → UTC の Date。
 * 例: ("2025-01-10", "04:00") → 2025-01-11 04:00 JST(=翌暦日の早朝)。
 * 10:00〜23:59 は当日、00:00〜09:59 は翌暦日として解釈する。
 * シフト予定(20:00〜翌5:00)の開始・終了時刻を営業日基準で組み立てる用途。
 */
export function businessDateTimeToDate(businessDate: BusinessDateString, hhmm: string): Date {
  assertBusinessDateString(businessDate);
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) {
    throw new TypeError(`時刻は HH:mm 形式で指定してください: ${hhmm}`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new TypeError(`時刻の範囲が不正です: ${hhmm}`);
  }
  const calendarDate = hour < BUSINESS_DAY_BOUNDARY_HOUR ? addBusinessDays(businessDate, 1) : businessDate;
  return fromZonedTime(`${calendarDate}T${hhmm}:00`, BUSINESS_TIMEZONE);
}

/**
 * 任意の時刻を Asia/Tokyo で書式化する(表示用)。date-fns の書式トークンを使用。
 */
export function formatInTokyo(input: DateInput, pattern = 'yyyy-MM-dd HH:mm'): string {
  return formatInTimeZone(toDate(input), BUSINESS_TIMEZONE, pattern);
}

/**
 * 任意の時刻の Asia/Tokyo における壁時計の各要素を返す(深夜割増判定などの下地)。
 */
export function tokyoWallClock(input: DateInput): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const zoned = toZonedTime(toDate(input), BUSINESS_TIMEZONE);
  return {
    year: zoned.getFullYear(),
    month: zoned.getMonth() + 1,
    day: zoned.getDate(),
    hour: zoned.getHours(),
    minute: zoned.getMinutes(),
    second: zoned.getSeconds(),
  };
}
