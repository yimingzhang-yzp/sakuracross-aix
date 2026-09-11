/**
 * 生年月日からの未成年判定
 *
 * 18 歳未満は 22:00 以降のシフトに入れないため、判定は**常に生年月日から再計算**する。
 * Staff.isMinor は保存時に書き込む導出値のキャッシュで、誕生日をまたいだ瞬間に
 * DB を更新しなくても正しく判定できるよう、読み出し側でこのモジュールを通す。
 *
 * 生年月日が未登録のスタッフ(過去に登録した人)は、保存済みの isMinor を使う。
 */
import { dbValueToBusinessDate, formatInTokyo } from '@sakura-cross/business-date';

/** 労働基準法の深夜業制限がかかる年齢(満 18 歳未満) */
export const MINOR_UNDER_AGE = 18;

/** 今日(Asia/Tokyo の暦日)。営業日とは違い 10:00 境界は使わない */
export function todayInTokyo(at: Date = new Date()): string {
  return formatInTokyo(at, 'yyyy-MM-dd');
}

/**
 * YYYY-MM-DD 同士で満年齢を求める。誕生日当日に 1 つ増える。
 */
export function ageOn(birth: string, on: string): number {
  const [by, bm, bd] = birth.split('-').map(Number) as [number, number, number];
  const [oy, om, od] = on.split('-').map(Number) as [number, number, number];
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age -= 1;
  return age;
}

/** Prisma の @db.Date 値 → YYYY-MM-DD */
export function birthDateString(birthDate: Date | null | undefined): string | null {
  return birthDate ? dbValueToBusinessDate(birthDate) : null;
}

/** 生年月日から満年齢。未登録なら null */
export function ageOf(birthDate: Date | null | undefined, at: Date = new Date()): number | null {
  const birth = birthDateString(birthDate);
  return birth ? ageOn(birth, todayInTokyo(at)) : null;
}

/**
 * 未成年(18 歳未満)か。
 * 生年月日があればそれが唯一の根拠。無ければ保存済みのフラグにフォールバックする。
 */
export function isMinorNow(staff: { birthDate?: Date | null; isMinor?: boolean }, at: Date = new Date()): boolean {
  const age = ageOf(staff.birthDate, at);
  if (age === null) return staff.isMinor === true;
  return age < MINOR_UNDER_AGE;
}

/** 入力された生年月日の妥当性。問題なければ null */
export function validateBirthDate(value: string, at: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '生年月日は YYYY-MM-DD で入力してください';
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return '存在しない日付です';
  }
  const today = todayInTokyo(at);
  if (value > today) return '生年月日が未来の日付になっています';
  const age = ageOn(value, today);
  if (age > 100) return '生年月日を確認してください(満 100 歳を超えています)';
  if (age < 14) return '生年月日を確認してください(満 14 歳未満は就業できません)';
  return null;
}
