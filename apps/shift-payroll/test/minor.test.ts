import { describe, expect, it } from 'vitest';

import { ageOf, ageOn, isMinorNow, todayInTokyo, validateBirthDate } from '../lib/staff/minor';

/** @db.Date は UTC 深夜で保存される */
const dbDate = (s: string) => new Date(`${s}T00:00:00Z`);
/** JST の壁時計 */
const jst = (s: string) => new Date(`${s}+09:00`);

describe('ageOn(満年齢)', () => {
  it('誕生日当日に 1 つ増える', () => {
    expect(ageOn('2008-09-11', '2026-09-10')).toBe(17);
    expect(ageOn('2008-09-11', '2026-09-11')).toBe(18);
    expect(ageOn('2008-09-11', '2026-09-12')).toBe(18);
  });

  it('月をまたぐ境界', () => {
    expect(ageOn('2008-12-31', '2026-12-30')).toBe(17);
    expect(ageOn('2008-01-01', '2026-01-01')).toBe(18);
  });

  it('2/29 生まれは 3/1 に増える(2月末日には増えない)', () => {
    expect(ageOn('2008-02-29', '2026-02-28')).toBe(17);
    expect(ageOn('2008-02-29', '2026-03-01')).toBe(18);
  });
});

describe('todayInTokyo', () => {
  it('JST の暦日を返す(営業日の 10:00 境界は使わない)', () => {
    // 深夜 2 時は営業日では前日だが、年齢計算では当日として扱う
    expect(todayInTokyo(jst('2026-09-11T02:00:00'))).toBe('2026-09-11');
    expect(todayInTokyo(jst('2026-09-11T23:59:00'))).toBe('2026-09-11');
    // UTC 15:00 = JST 翌 0:00
    expect(todayInTokyo(new Date('2026-09-10T15:00:00Z'))).toBe('2026-09-11');
  });
});

describe('isMinorNow', () => {
  const at = jst('2026-09-11T12:00:00');

  it('18 歳未満は true、18 歳到達日から false', () => {
    expect(isMinorNow({ birthDate: dbDate('2009-01-01') }, at)).toBe(true);
    expect(isMinorNow({ birthDate: dbDate('2008-09-12') }, at)).toBe(true);
    expect(isMinorNow({ birthDate: dbDate('2008-09-11') }, at)).toBe(false);
    expect(isMinorNow({ birthDate: dbDate('2000-05-05') }, at)).toBe(false);
  });

  it('生年月日があれば、保存済みフラグではなく生年月日を信じる', () => {
    // 誕生日を迎えて 18 歳になったのに DB のフラグが古いケース
    expect(isMinorNow({ birthDate: dbDate('2008-09-11'), isMinor: true }, at)).toBe(false);
    // 逆に、フラグが false でも実際は未成年のケース
    expect(isMinorNow({ birthDate: dbDate('2010-04-01'), isMinor: false }, at)).toBe(true);
  });

  it('生年月日が未登録なら保存済みフラグにフォールバックする', () => {
    expect(isMinorNow({ birthDate: null, isMinor: true }, at)).toBe(true);
    expect(isMinorNow({ birthDate: null, isMinor: false }, at)).toBe(false);
    expect(isMinorNow({}, at)).toBe(false);
  });

  it('ageOf は未登録なら null', () => {
    expect(ageOf(dbDate('2000-05-05'), at)).toBe(26);
    expect(ageOf(null, at)).toBeNull();
  });
});

describe('validateBirthDate', () => {
  const at = jst('2026-09-11T12:00:00');

  it('正常な日付は null(エラーなし)', () => {
    expect(validateBirthDate('2008-09-11', at)).toBeNull();
    expect(validateBirthDate('1980-01-31', at)).toBeNull();
  });

  it('形式不正・存在しない日付を弾く', () => {
    expect(validateBirthDate('2008/09/11', at)).toContain('YYYY-MM-DD');
    expect(validateBirthDate('2026-02-30', at)).toContain('存在しない');
  });

  it('未来日を弾く', () => {
    expect(validateBirthDate('2026-09-12', at)).toContain('未来');
  });

  it('現実的でない年齢を弾く', () => {
    expect(validateBirthDate('1900-01-01', at)).toContain('100 歳');
    expect(validateBirthDate('2015-01-01', at)).toContain('14 歳');
  });

  it('満 14 歳の当日は通る', () => {
    expect(validateBirthDate('2012-09-11', at)).toBeNull();
  });
});
