import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BUSINESS_TIMEZONE,
  addBusinessDays,
  businessDateTimeToDate,
  businessDateToDbValue,
  currentBusinessDate,
  dbValueToBusinessDate,
  diffBusinessDays,
  formatInTokyo,
  getBusinessDateRange,
  isBusinessDateString,
  isInBusinessDate,
  toBusinessDate,
  toBusinessDateDbValue,
  tokyoWallClock,
} from './index.js';

describe('toBusinessDate: 営業日境界(必須ケース)', () => {
  it('20:00 JST は当日の営業日', () => {
    expect(toBusinessDate('2025-01-10T20:00:00+09:00')).toBe('2025-01-10');
  });

  it('翌 09:59:59 JST はまだ前日の営業日', () => {
    expect(toBusinessDate('2025-01-11T09:59:59+09:00')).toBe('2025-01-10');
    expect(toBusinessDate('2025-01-11T09:59:59.999+09:00')).toBe('2025-01-10');
  });

  it('翌 10:00:00 JST で営業日が切り替わる', () => {
    expect(toBusinessDate('2025-01-11T10:00:00+09:00')).toBe('2025-01-11');
  });

  it('README の例: 1/10 22:00 も 1/11 04:00 も「1/10 営業日」', () => {
    expect(toBusinessDate('2025-01-10T22:00:00+09:00')).toBe('2025-01-10');
    expect(toBusinessDate('2025-01-11T04:00:00+09:00')).toBe('2025-01-10');
  });

  it('営業終了直後(翌 05:00)も前日の営業日', () => {
    expect(toBusinessDate('2025-01-11T05:00:00+09:00')).toBe('2025-01-10');
  });
});

describe('toBusinessDate: 月末・年末境界', () => {
  it('1/1 03:00 JST は 12/31 営業日(年またぎ)', () => {
    expect(toBusinessDate('2025-01-01T03:00:00+09:00')).toBe('2024-12-31');
  });

  it('3/1 09:59 JST は 2/28 営業日(閏年でない年)', () => {
    expect(toBusinessDate('2025-03-01T09:59:00+09:00')).toBe('2025-02-28');
  });

  it('3/1 09:59 JST は 2/29 営業日(閏年)', () => {
    expect(toBusinessDate('2024-03-01T09:59:00+09:00')).toBe('2024-02-29');
  });
});

describe('toBusinessDate: 入力形式', () => {
  it('Date / epoch ms / UTC 文字列 のいずれでも同じ結果', () => {
    const iso = '2025-01-10T15:00:00.000Z'; // = 2025-01-11 00:00 JST
    const date = new Date(iso);
    expect(toBusinessDate(date)).toBe('2025-01-10');
    expect(toBusinessDate(date.getTime())).toBe('2025-01-10');
    expect(toBusinessDate(iso)).toBe('2025-01-10');
  });

  it('不正な日時は例外', () => {
    expect(() => toBusinessDate('not-a-date')).toThrow(TypeError);
    expect(() => toBusinessDate(new Date(NaN))).toThrow(TypeError);
  });

  it('currentBusinessDate は now を差し替え可能', () => {
    expect(currentBusinessDate('2025-01-11T09:00:00+09:00')).toBe('2025-01-10');
  });
});

describe('サーバーのローカルタイムゾーンに依存しない', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  it.each(['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland'])(
    'TZ=%s でも境界値の結果が同一',
    (tz) => {
      process.env.TZ = tz;
      expect(toBusinessDate('2025-01-10T20:00:00+09:00')).toBe('2025-01-10');
      expect(toBusinessDate('2025-01-11T09:59:59+09:00')).toBe('2025-01-10');
      expect(toBusinessDate('2025-01-11T10:00:00+09:00')).toBe('2025-01-11');
      expect(getBusinessDateRange('2025-01-10').start.toISOString()).toBe('2025-01-10T01:00:00.000Z');
    },
  );

  it('BUSINESS_TIMEZONE は Asia/Tokyo 固定', () => {
    expect(BUSINESS_TIMEZONE).toBe('Asia/Tokyo');
  });
});

describe('getBusinessDateRange', () => {
  it('[当日10:00 JST, 翌日10:00 JST) を返す', () => {
    const { start, end } = getBusinessDateRange('2025-01-10');
    expect(start.toISOString()).toBe('2025-01-10T01:00:00.000Z'); // 10:00 JST
    expect(end.toISOString()).toBe('2025-01-11T01:00:00.000Z'); // 翌 10:00 JST
  });

  it('範囲の始点は含み、終点は含まない', () => {
    const { start, end } = getBusinessDateRange('2025-01-10');
    expect(toBusinessDate(start)).toBe('2025-01-10');
    expect(toBusinessDate(new Date(end.getTime() - 1))).toBe('2025-01-10');
    expect(toBusinessDate(end)).toBe('2025-01-11');
  });

  it('不正な営業日文字列は例外', () => {
    expect(() => getBusinessDateRange('2025/01/10')).toThrow(TypeError);
    expect(() => getBusinessDateRange('2025-02-30')).toThrow(TypeError);
  });
});

describe('isInBusinessDate / addBusinessDays / diffBusinessDays', () => {
  it('isInBusinessDate', () => {
    expect(isInBusinessDate('2025-01-11T04:00:00+09:00', '2025-01-10')).toBe(true);
    expect(isInBusinessDate('2025-01-11T10:00:00+09:00', '2025-01-10')).toBe(false);
  });

  it('addBusinessDays は月末・年末をまたぐ', () => {
    expect(addBusinessDays('2025-01-31', 1)).toBe('2025-02-01');
    expect(addBusinessDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addBusinessDays('2025-01-01', -1)).toBe('2024-12-31');
  });

  it('diffBusinessDays', () => {
    expect(diffBusinessDays('2025-01-10', '2025-01-25')).toBe(15);
    expect(diffBusinessDays('2025-01-25', '2025-01-10')).toBe(-15);
  });
});

describe('Prisma @db.Date との相互変換', () => {
  it('businessDateToDbValue は UTC 深夜 0 時の Date', () => {
    expect(businessDateToDbValue('2025-01-10').toISOString()).toBe('2025-01-10T00:00:00.000Z');
  });

  it('toBusinessDateDbValue は時刻から直接 DB 値を作る', () => {
    expect(toBusinessDateDbValue('2025-01-11T04:00:00+09:00').toISOString()).toBe(
      '2025-01-10T00:00:00.000Z',
    );
  });

  it('dbValueToBusinessDate は営業日オフセットを適用しない(往復で一致)', () => {
    const db = businessDateToDbValue('2025-01-10');
    expect(dbValueToBusinessDate(db)).toBe('2025-01-10');
  });

  it('isBusinessDateString', () => {
    expect(isBusinessDateString('2025-01-10')).toBe(true);
    expect(isBusinessDateString('2025-1-10')).toBe(false);
    expect(isBusinessDateString('2025-13-01')).toBe(false);
    expect(isBusinessDateString('2025-02-29')).toBe(false);
    expect(isBusinessDateString(20250110)).toBe(false);
  });
});

describe('businessDateTimeToDate: 営業日 + 壁時計 → UTC', () => {
  it('20:00 は当日、04:00 は翌暦日として解釈', () => {
    expect(businessDateTimeToDate('2025-01-10', '20:00').toISOString()).toBe('2025-01-10T11:00:00.000Z');
    expect(businessDateTimeToDate('2025-01-10', '04:00').toISOString()).toBe('2025-01-10T19:00:00.000Z');
  });

  it('09:59 は翌暦日、10:00 は当日(境界)', () => {
    expect(businessDateTimeToDate('2025-01-10', '09:59').toISOString()).toBe('2025-01-11T00:59:00.000Z');
    expect(businessDateTimeToDate('2025-01-10', '10:00').toISOString()).toBe('2025-01-10T01:00:00.000Z');
  });

  it('組み立てた時刻は同じ営業日に属する', () => {
    for (const hhmm of ['10:00', '20:00', '23:59', '00:00', '04:30', '09:59']) {
      expect(toBusinessDate(businessDateTimeToDate('2025-01-10', hhmm))).toBe('2025-01-10');
    }
  });

  it('不正な時刻は例外', () => {
    expect(() => businessDateTimeToDate('2025-01-10', '24:00')).toThrow(TypeError);
    expect(() => businessDateTimeToDate('2025-01-10', '9:00')).toThrow(TypeError);
  });
});

describe('表示用ヘルパー', () => {
  it('formatInTokyo は JST で書式化', () => {
    expect(formatInTokyo('2025-01-10T15:00:00.000Z')).toBe('2025-01-11 00:00');
    expect(formatInTokyo('2025-01-10T15:00:00.000Z', 'M/d HH:mm')).toBe('1/11 00:00');
  });

  it('tokyoWallClock は JST の各要素を返す', () => {
    expect(tokyoWallClock('2025-01-10T15:30:45.000Z')).toEqual({
      year: 2025,
      month: 1,
      day: 11,
      hour: 0,
      minute: 30,
      second: 45,
    });
  });
});

describe('タイムゾーンを変えた状態での壁時計変換', () => {
  const originalTz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'America/New_York';
  });
  afterEach(() => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  it('TZ=America/New_York でも JST の壁時計を返す', () => {
    expect(tokyoWallClock('2025-01-10T15:30:00.000Z').hour).toBe(0);
    expect(formatInTokyo('2025-01-10T15:30:00.000Z', 'HH:mm')).toBe('00:30');
  });
});
