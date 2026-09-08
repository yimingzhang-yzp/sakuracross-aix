/**
 * 表示用フォーマッタ(すべて Asia/Tokyo)
 */
import { dbValueToBusinessDate, formatInTokyo } from '@sakura-cross/business-date';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function yen(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`;
}

export function hhmm(date: Date | string | null | undefined): string {
  if (!date) return '—';
  return formatInTokyo(date, 'HH:mm');
}

export function datetimeJp(date: Date | string | null | undefined): string {
  if (!date) return '—';
  return formatInTokyo(date, 'M/d HH:mm');
}

export function minutesToHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** YYYY-MM-DD → "1/10(金)" */
export function businessDateLabel(businessDate: string, withYear = false): string {
  const [y, m, d] = businessDate.split('-').map(Number) as [number, number, number];
  const dow = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return withYear ? `${y}/${m}/${d}(${dow})` : `${m}/${d}(${dow})`;
}

export function weekdayOf(businessDate: string): number {
  return new Date(`${businessDate}T00:00:00Z`).getUTCDay();
}

/** Prisma の @db.Date 値 → YYYY-MM-DD */
export function bd(value: Date): string {
  return dbValueToBusinessDate(value);
}

/** 営業日基準の時間帯表示 "20:00〜翌5:00" */
export function timeRange(start: Date, end: Date): string {
  const s = formatInTokyo(start, 'HH:mm');
  const e = formatInTokyo(end, 'HH:mm');
  const crossesDay = formatInTokyo(start, 'yyyy-MM-dd') !== formatInTokyo(end, 'yyyy-MM-dd');
  return `${s}〜${crossesDay ? '翌' : ''}${e}`;
}

export const EMPLOYMENT_LABELS: Record<string, string> = {
  PART_TIME: 'アルバイト',
  FULL_TIME: '社員',
  CONTRACT: '契約',
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  NORMAL: '通常営業',
  WEEKEND: '週末営業',
  BIG_EVENT: 'ビッグイベント',
  RENTAL: '貸切',
  CLOSED: '休業',
};

export const AVAILABILITY_LABELS: Record<string, string> = {
  OK: '○',
  NG: '×',
  EARLY_ONLY: '早',
  LATE_ONLY: '遅',
};

export const SHIFT_STATUS_LABELS: Record<string, string> = {
  DRAFT: '下書き',
  CONFIRMED: '確定',
  CANCELLED: '取消',
  ABSENT: '欠勤',
};
