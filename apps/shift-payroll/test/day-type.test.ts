import { describe, expect, it } from 'vitest';

import { suggestEventType, weekdayOfBusinessDate } from '../lib/scheduling/day-type';
import { DEFAULT_SETTINGS } from '../lib/settings';

describe('曜日ルールによる営業日種別', () => {
  // 2026-09-06 は日曜
  it('既定: 日・月は休業、金・土は週末営業、それ以外は通常営業', () => {
    expect(weekdayOfBusinessDate('2026-09-06')).toBe(0);
    expect(suggestEventType('2026-09-06', DEFAULT_SETTINGS)).toBe('CLOSED'); // 日
    expect(suggestEventType('2026-09-07', DEFAULT_SETTINGS)).toBe('CLOSED'); // 月
    expect(suggestEventType('2026-09-08', DEFAULT_SETTINGS)).toBe('NORMAL'); // 火
    expect(suggestEventType('2026-09-09', DEFAULT_SETTINGS)).toBe('NORMAL'); // 水
    expect(suggestEventType('2026-09-10', DEFAULT_SETTINGS)).toBe('NORMAL'); // 木
    expect(suggestEventType('2026-09-11', DEFAULT_SETTINGS)).toBe('WEEKEND'); // 金
    expect(suggestEventType('2026-09-12', DEFAULT_SETTINGS)).toBe('WEEKEND'); // 土
  });

  it('日曜は定休日が週末営業より優先。営業にする場合の提案は週末営業', () => {
    expect(DEFAULT_SETTINGS.closedWeekdays).toContain(0);
    expect(DEFAULT_SETTINGS.weekendWeekdays).toContain(0);
    expect(suggestEventType('2026-09-06', DEFAULT_SETTINGS, { ignoreClosed: true })).toBe('WEEKEND');
  });

  it('設定で曜日を変えられる', () => {
    const rules = { closedWeekdays: [2], weekendWeekdays: [6] };
    expect(suggestEventType('2026-09-08', rules)).toBe('CLOSED'); // 火
    expect(suggestEventType('2026-09-11', rules)).toBe('NORMAL'); // 金
    expect(suggestEventType('2026-09-12', rules)).toBe('WEEKEND'); // 土
  });
});
