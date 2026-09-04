import { formatInTokyo } from '@sakura-cross/business-date';

/** 管理画面の日時表示(Asia/Tokyo) */
export function formatTokyo(date: Date | string | null | undefined, pattern = 'M/d HH:mm'): string {
  if (!date) return '—';
  try {
    return formatInTokyo(date, pattern);
  } catch {
    return '—';
  }
}

export function formatTokyoFull(date: Date | string | null | undefined): string {
  return formatTokyo(date, 'yyyy/MM/dd HH:mm');
}

export function truncate(text: string, max = 80): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max)}…` : single;
}
