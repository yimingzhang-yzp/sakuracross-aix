import { describe, expect, it } from 'vitest';

import {
  PayrollLockedError,
  applyBreak,
  assertNotLocked,
  computeAutoBreak,
  computeDaily,
  computeNightMinutes,
  computePayroll,
  getPayrollPeriod,
  resolveHourlyWage,
  roundClock,
} from '../lib/payroll/compute';
import { buildPayrollCsv, formatMinutesAsHours } from '../lib/payroll/csv';
import type { PayrollStaffInput, TimeRecordInput } from '../lib/payroll/types';
import { DEFAULT_SETTINGS, type ShiftPayrollSettings } from '../lib/settings';

/** JST の壁時計から Date を作る */
const jst = (iso: string) => new Date(`${iso}+09:00`);

const hourly: PayrollStaffInput = {
  id: 'staff-hourly',
  name: '山田 花子',
  employmentType: 'PART_TIME',
  hourlyWage: 1300,
  monthlySalary: null,
};

const salaried: PayrollStaffInput = {
  id: 'staff-salaried',
  name: '佐藤 太郎',
  employmentType: 'FULL_TIME',
  hourlyWage: 0,
  monthlySalary: 280_000,
};

function record(partial: Partial<TimeRecordInput> & { businessDate: string; clockIn: Date | null; clockOut: Date | null }): TimeRecordInput {
  return {
    id: `tr-${partial.businessDate}`,
    staffId: hourly.id,
    breakMinutes: 0,
    approved: true,
    ...partial,
  };
}

const settings: ShiftPayrollSettings = { ...DEFAULT_SETTINGS };
const noAutoBreak: ShiftPayrollSettings = { ...DEFAULT_SETTINGS, autoBreakEnabled: false };
const wage1300 = [{ staffId: hourly.id, hourlyWage: 1300, effectiveFrom: '2024-01-01' }];

describe('受け入れ基準: 20:00〜翌4:00 の勤務で深夜割増が 6 時間分', () => {
  const rec = record({ businessDate: '2025-01-10', clockIn: jst('2025-01-10T20:00:00'), clockOut: jst('2025-01-11T04:00:00') });

  it('休憩自動控除なし: 通常 2h + 深夜 6h', () => {
    const daily = computeDaily(rec, hourly, wage1300, noAutoBreak);
    expect(daily.totalMinutes).toBe(480);
    expect(daily.nightMinutes).toBe(360);
    expect(daily.basePay).toBe(1300 * 8);
    expect(daily.nightPremiumPay).toBe(1300 * 6 * 0.25);
  });

  it('休憩自動控除あり(8h 在店 → 45 分): 休憩は通常時間帯から控除され、深夜 6h は維持', () => {
    const daily = computeDaily(rec, hourly, wage1300, settings);
    expect(daily.autoBreakApplied).toBe(true);
    expect(daily.breakMinutes).toBe(45);
    expect(daily.totalMinutes).toBe(435);
    expect(daily.nightMinutes).toBe(360);
    expect(daily.nightPremiumPay).toBe(1300 * 6 * 0.25);
  });

  it('computePayroll でも同じ結果(基本給 + 割増 = 総支給)', () => {
    const result = computePayroll({
      period: { start: '2025-01-01', end: '2025-01-31' },
      staff: [hourly],
      timeRecords: [rec],
      wageHistories: wage1300,
      incentives: [],
      advancePayments: [],
      settings: noAutoBreak,
    });
    const item = result.items[0]!;
    expect(item.nightMinutes).toBe(360);
    expect(item.basePay).toBe(10_400);
    expect(item.nightPremiumPay).toBe(1_950);
    expect(item.grossPay).toBe(12_350);
    expect(item.netPay).toBe(12_350);
  });
});

describe('受け入れ基準: 月途中の時給改定は WageHistory を参照', () => {
  const histories = [
    { staffId: hourly.id, hourlyWage: 1300, effectiveFrom: '2024-04-01' },
    { staffId: hourly.id, hourlyWage: 1400, effectiveFrom: '2025-01-15' },
  ];

  it('改定日前は 1,300 円、改定日以降は 1,400 円', () => {
    expect(resolveHourlyWage(hourly, histories, '2025-01-14').hourlyWage).toBe(1300);
    expect(resolveHourlyWage(hourly, histories, '2025-01-15').hourlyWage).toBe(1400);
    expect(resolveHourlyWage(hourly, histories, '2025-02-01').hourlyWage).toBe(1400);
  });

  it('Staff.hourlyWage(キャッシュ)を変えても履歴の値で計算される', () => {
    const staffWithStaleCache = { ...hourly, hourlyWage: 9999 };
    const before = record({ businessDate: '2025-01-10', clockIn: jst('2025-01-10T20:00:00'), clockOut: jst('2025-01-10T22:00:00') });
    const after = record({ businessDate: '2025-01-20', clockIn: jst('2025-01-20T20:00:00'), clockOut: jst('2025-01-20T22:00:00') });
    const result = computePayroll({
      period: { start: '2025-01-01', end: '2025-01-31' },
      staff: [staffWithStaleCache],
      timeRecords: [before, after],
      wageHistories: histories,
      incentives: [],
      advancePayments: [],
      settings: noAutoBreak,
    });
    const item = result.items[0]!;
    expect(item.breakdown.map((d) => d.hourlyWage)).toEqual([1300, 1400]);
    expect(item.basePay).toBe(1300 * 2 + 1400 * 2);
  });

  it('履歴が無ければ Staff.hourlyWage を使い警告を出す', () => {
    const daily = computeDaily(
      record({ businessDate: '2025-01-10', clockIn: jst('2025-01-10T20:00:00'), clockOut: jst('2025-01-10T21:00:00') }),
      hourly,
      [],
      settings,
    );
    expect(daily.wageSource).toBe('staff_fallback');
    expect(daily.warnings.join()).toContain('時給履歴が無い');
  });
});

describe('受け入れ基準: 9 時間勤務・休憩未入力 → 60 分自動控除', () => {
  it('60 分が控除され、明細に自動控除フラグが立つ', () => {
    const rec = record({ businessDate: '2025-01-10', clockIn: jst('2025-01-10T19:00:00'), clockOut: jst('2025-01-11T04:00:00') });
    const daily = computeDaily(rec, hourly, wage1300, settings);
    expect(daily.rawMinutes).toBe(540);
    expect(daily.breakMinutes).toBe(60);
    expect(daily.autoBreakApplied).toBe(true);
    expect(daily.totalMinutes).toBe(480);
  });

  it('手入力の休憩があれば自動控除しない', () => {
    const rec = record({ businessDate: '2025-01-10', clockIn: jst('2025-01-10T19:00:00'), clockOut: jst('2025-01-11T04:00:00'), breakMinutes: 30 });
    const daily = computeDaily(rec, hourly, wage1300, settings);
    expect(daily.breakMinutes).toBe(30);
    expect(daily.autoBreakApplied).toBe(false);
  });

  it('ルールの境界: 6h ちょうどは控除なし、6h1分で 45 分、8h1分で 60 分', () => {
    expect(computeAutoBreak(360, DEFAULT_SETTINGS.autoBreakRules)).toBe(0);
    expect(computeAutoBreak(361, DEFAULT_SETTINGS.autoBreakRules)).toBe(45);
    expect(computeAutoBreak(480, DEFAULT_SETTINGS.autoBreakRules)).toBe(45);
    expect(computeAutoBreak(481, DEFAULT_SETTINGS.autoBreakRules)).toBe(60);
  });

  it('設定で OFF にできる', () => {
    const rec = record({ businessDate: '2025-01-10', clockIn: jst('2025-01-10T19:00:00'), clockOut: jst('2025-01-11T04:00:00') });
    expect(computeDaily(rec, hourly, wage1300, noAutoBreak).breakMinutes).toBe(0);
  });
});

describe('受け入れ基準: 日払い 5,000 円の控除', () => {
  it('差引支給が 5,000 円減る', () => {
    const rec = record({ businessDate: '2025-01-10', clockIn: jst('2025-01-10T20:00:00'), clockOut: jst('2025-01-11T00:00:00') });
    const base = computePayroll({
      period: { start: '2025-01-01', end: '2025-01-31' },
      staff: [hourly],
      timeRecords: [rec],
      wageHistories: wage1300,
      incentives: [],
      advancePayments: [],
      settings,
    }).items[0]!;
    const withAdvance = computePayroll({
      period: { start: '2025-01-01', end: '2025-01-31' },
      staff: [hourly],
      timeRecords: [rec],
      wageHistories: wage1300,
      incentives: [],
      advancePayments: [{ staffId: hourly.id, businessDate: '2025-01-10', amount: 5000 }],
      settings,
    }).items[0]!;
    expect(withAdvance.grossPay).toBe(base.grossPay);
    expect(withAdvance.advanceDeduction).toBe(5000);
    expect(withAdvance.netPay).toBe(base.netPay - 5000);
  });

  it('期間外の日払いは控除しない', () => {
    const rec = record({ businessDate: '2025-01-10', clockIn: jst('2025-01-10T20:00:00'), clockOut: jst('2025-01-11T00:00:00') });
    const result = computePayroll({
      period: { start: '2025-01-01', end: '2025-01-31' },
      staff: [hourly],
      timeRecords: [rec],
      wageHistories: wage1300,
      incentives: [],
      advancePayments: [{ staffId: hourly.id, businessDate: '2025-02-01', amount: 5000 }],
      settings,
    });
    expect(result.items[0]!.advanceDeduction).toBe(0);
  });
});

describe('法定控除が差引支給に反映される', () => {
  it('社保・雇用保険加入の社員: 差引 = 月給 − 社会保険料 − 雇用保険料 − 所得税 − 日払い', () => {
    const insured: PayrollStaffInput = {
      ...salaried,
      socialInsuranceEnrolled: true,
      employmentInsuranceEnrolled: true,
      standardMonthlyRemuneration: 280_000,
      taxTableType: 'KOU',
      dependentsCount: 0,
    };
    const result = computePayroll({
      period: { start: '2026-08-01', end: '2026-08-31' },
      staff: [insured],
      timeRecords: [],
      wageHistories: [],
      incentives: [],
      advancePayments: [{ staffId: insured.id, businessDate: '2026-08-10', amount: 10_000 }],
      settings,
    });
    const item = result.items[0]!;
    expect(item.grossPay).toBe(280_000);
    expect(item.healthInsurance).toBe(13_874);
    expect(item.pensionInsurance).toBe(25_620);
    expect(item.employmentInsurance).toBe(1_540);
    expect(item.incomeTax).toBe(4_460);
    expect(item.totalDeductions).toBe(45_494);
    expect(item.netPay).toBe(280_000 - 45_494 - 10_000);
  });

  it('控除の警告(標準報酬月額の推定)は明細の警告に含まれる', () => {
    const insured: PayrollStaffInput = { ...salaried, socialInsuranceEnrolled: true };
    const result = computePayroll({
      period: { start: '2026-08-01', end: '2026-08-31' },
      staff: [insured],
      timeRecords: [],
      wageHistories: [],
      incentives: [],
      advancePayments: [],
      settings,
    });
    expect(result.items[0]!.standardMonthlyRemuneration).toBe(280_000);
    expect(result.items[0]!.warnings.join()).toContain('標準報酬月額が未設定');
  });
});

describe('受け入れ基準: FINALIZED 期間の編集ブロック', () => {
  const finalized = [{ id: 'run-1', periodStart: '2025-01-01', periodEnd: '2025-01-31' }];

  it('確定済み期間内の営業日は PayrollLockedError', () => {
    expect(() => assertNotLocked(finalized, '2025-01-15')).toThrow(PayrollLockedError);
    expect(() => assertNotLocked(finalized, '2025-01-01')).toThrow(PayrollLockedError);
    expect(() => assertNotLocked(finalized, '2025-01-31')).toThrow(PayrollLockedError);
  });

  it('期間外は通る', () => {
    expect(() => assertNotLocked(finalized, '2025-02-01')).not.toThrow();
    expect(() => assertNotLocked([], '2025-01-15')).not.toThrow();
  });

  it('エラーメッセージに再計算の案内が含まれる', () => {
    try {
      assertNotLocked(finalized, '2025-01-15');
    } catch (e) {
      expect((e as Error).message).toContain('再計算');
    }
  });
});

describe('深夜時間帯の判定(日またぎ)', () => {
  it('18:00〜23:00 → 深夜 60 分', () => {
    expect(computeNightMinutes(jst('2025-01-10T18:00:00'), jst('2025-01-10T23:00:00'), '2025-01-10', settings)).toBe(60);
  });

  it('翌 4:00〜9:00(同じ営業日) → 深夜 60 分(4:00〜5:00)', () => {
    expect(computeNightMinutes(jst('2025-01-11T04:00:00'), jst('2025-01-11T09:00:00'), '2025-01-10', settings)).toBe(60);
  });

  it('20:00〜22:00 → 深夜 0 分、22:00〜翌5:00 → 420 分', () => {
    expect(computeNightMinutes(jst('2025-01-10T20:00:00'), jst('2025-01-10T22:00:00'), '2025-01-10', settings)).toBe(0);
    expect(computeNightMinutes(jst('2025-01-10T22:00:00'), jst('2025-01-11T05:00:00'), '2025-01-10', settings)).toBe(420);
  });

  it('applyBreak は通常時間帯から先に控除する', () => {
    expect(applyBreak(480, 360, 45)).toEqual({ totalMinutes: 435, nightMinutes: 360 });
    expect(applyBreak(480, 360, 150)).toEqual({ totalMinutes: 330, nightMinutes: 330 });
    expect(applyBreak(420, 420, 60)).toEqual({ totalMinutes: 360, nightMinutes: 360 });
  });
});

describe('打刻の丸め', () => {
  const inTime = jst('2025-01-10T20:07:00');
  const outTime = jst('2025-01-11T03:52:00');

  it('丸めなし(既定)', () => {
    expect(roundClock(inTime, 0, 'favor_worker', 'in').getTime()).toBe(inTime.getTime());
  });

  it('favor_worker: 出勤は早い方へ、退勤は遅い方へ', () => {
    expect(roundClock(inTime, 15, 'favor_worker', 'in')).toEqual(jst('2025-01-10T20:00:00'));
    expect(roundClock(outTime, 15, 'favor_worker', 'out')).toEqual(jst('2025-01-11T04:00:00'));
  });

  it('strict: 出勤は遅い方へ、退勤は早い方へ', () => {
    expect(roundClock(inTime, 15, 'strict', 'in')).toEqual(jst('2025-01-10T20:15:00'));
    expect(roundClock(outTime, 15, 'strict', 'out')).toEqual(jst('2025-01-11T03:45:00'));
  });

  it('nearest', () => {
    expect(roundClock(inTime, 15, 'nearest', 'in')).toEqual(jst('2025-01-10T20:00:00'));
    expect(roundClock(jst('2025-01-10T20:08:00'), 15, 'nearest', 'in')).toEqual(jst('2025-01-10T20:15:00'));
  });

  it('ちょうど境界なら変化しない', () => {
    expect(roundClock(jst('2025-01-10T20:00:00'), 15, 'strict', 'in')).toEqual(jst('2025-01-10T20:00:00'));
  });
});

describe('月給制社員', () => {
  it('固定額のみ計上、深夜割増なし。労働時間は記録される', () => {
    const rec = record({
      staffId: salaried.id,
      businessDate: '2025-01-10',
      clockIn: jst('2025-01-10T20:00:00'),
      clockOut: jst('2025-01-11T04:00:00'),
    });
    const result = computePayroll({
      period: { start: '2025-01-01', end: '2025-01-31' },
      staff: [salaried],
      timeRecords: [rec],
      wageHistories: [],
      incentives: [],
      advancePayments: [],
      settings: noAutoBreak,
    });
    const item = result.items[0]!;
    expect(item.monthlySalary).toBe(280_000);
    expect(item.basePay).toBe(280_000);
    expect(item.nightPremiumPay).toBe(0);
    expect(item.totalMinutes).toBe(480);
    expect(item.nightMinutes).toBe(360);
    expect(item.warnings).toEqual([]);
  });

  it('打刻が無くても月給者は明細が作られる', () => {
    const result = computePayroll({
      period: { start: '2025-01-01', end: '2025-01-31' },
      staff: [salaried],
      timeRecords: [],
      wageHistories: [],
      incentives: [],
      advancePayments: [],
      settings,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.grossPay).toBe(280_000);
  });
});

describe('承認・除外・警告', () => {
  it('未承認の打刻は除外され、警告が出る', () => {
    const approved = record({ businessDate: '2025-01-10', clockIn: jst('2025-01-10T20:00:00'), clockOut: jst('2025-01-10T22:00:00') });
    const pending = record({ businessDate: '2025-01-11', clockIn: jst('2025-01-11T20:00:00'), clockOut: jst('2025-01-11T22:00:00'), approved: false });
    const result = computePayroll({
      period: { start: '2025-01-01', end: '2025-01-31' },
      staff: [hourly],
      timeRecords: [approved, pending],
      wageHistories: wage1300,
      incentives: [],
      advancePayments: [],
      settings,
    });
    expect(result.items[0]!.totalMinutes).toBe(120);
    expect(result.warnings.join()).toContain('未承認');
    expect(result.items[0]!.warnings.join()).toContain('未承認');
  });

  it('退勤が無い打刻は除外され警告', () => {
    const rec = record({ businessDate: '2025-01-10', clockIn: jst('2025-01-10T20:00:00'), clockOut: null });
    const daily = computeDaily(rec, hourly, wage1300, settings);
    expect(daily.totalMinutes).toBe(0);
    expect(daily.warnings[0]).toContain('不完全');
  });

  it('期間に何も無いスタッフは明細を作らない', () => {
    const result = computePayroll({
      period: { start: '2025-02-01', end: '2025-02-28' },
      staff: [hourly],
      timeRecords: [],
      wageHistories: wage1300,
      incentives: [],
      advancePayments: [],
      settings,
    });
    expect(result.items).toHaveLength(0);
  });

  it('不正な期間は例外', () => {
    expect(() =>
      computePayroll({
        period: { start: '2025-02-10', end: '2025-02-01' },
        staff: [],
        timeRecords: [],
        wageHistories: [],
        incentives: [],
        advancePayments: [],
        settings,
      }),
    ).toThrow(TypeError);
  });
});

describe('端数処理', () => {
  // 1,300 円 × 7 分 = 151.666…
  const rec = record({ businessDate: '2025-01-10', clockIn: jst('2025-01-10T20:00:00'), clockOut: jst('2025-01-10T20:07:00') });

  it('floor_daily: 日別に切り捨て', () => {
    expect(computeDaily(rec, hourly, wage1300, settings).basePay).toBe(151);
  });

  it('round_daily: 日別に四捨五入', () => {
    expect(computeDaily(rec, hourly, wage1300, { ...settings, yenRounding: 'round_daily' }).basePay).toBe(152);
  });

  it('floor_monthly: 日別は小数を保持し、月合計で切り捨て', () => {
    const rec2 = { ...rec, id: 'tr-2', businessDate: '2025-01-11', clockIn: jst('2025-01-11T20:00:00'), clockOut: jst('2025-01-11T20:07:00') };
    const result = computePayroll({
      period: { start: '2025-01-01', end: '2025-01-31' },
      staff: [hourly],
      timeRecords: [rec, rec2],
      wageHistories: wage1300,
      incentives: [],
      advancePayments: [],
      settings: { ...settings, yenRounding: 'floor_monthly' },
    });
    // 151.666… × 2 = 303.333… → 303(日別切り捨てなら 302)
    expect(result.items[0]!.basePay).toBe(303);
  });
});

describe('給与期間', () => {
  it('月末締め', () => {
    expect(getPayrollPeriod('EOM', 2025, 1)).toEqual({ start: '2025-01-01', end: '2025-01-31' });
    expect(getPayrollPeriod('EOM', 2024, 2)).toEqual({ start: '2024-02-01', end: '2024-02-29' });
  });

  it('15 日締め', () => {
    expect(getPayrollPeriod(15, 2025, 3)).toEqual({ start: '2025-02-16', end: '2025-03-15' });
    expect(getPayrollPeriod(15, 2025, 1)).toEqual({ start: '2024-12-16', end: '2025-01-15' });
  });
});

describe('CSV 出力', () => {
  it('ヘッダ・明細・注記を含む', () => {
    const rec = record({ businessDate: '2025-01-10', clockIn: jst('2025-01-10T20:00:00'), clockOut: jst('2025-01-11T04:00:00') });
    const result = computePayroll({
      period: { start: '2025-01-01', end: '2025-01-31' },
      staff: [hourly],
      timeRecords: [rec],
      wageHistories: wage1300,
      incentives: [{ staffId: hourly.id, businessDate: '2025-01-10', kind: 'bottle_back', amount: 2000 }],
      advancePayments: [{ staffId: hourly.id, businessDate: '2025-01-10', amount: 5000 }],
      settings: noAutoBreak,
    });
    const csv = buildPayrollCsv(result.period, result.items);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('スタッフ名,雇用形態,総労働時間,深夜時間,基本給,深夜割増,インセンティブ,総支給,健康保険,介護保険,厚生年金,雇用保険,所得税,控除合計,控除(日払い),差引支給');
    // 未加入のアルバイト・課税対象額 14,350 円なので法定控除はすべて 0
    expect(lines[1]).toBe('山田 花子,アルバイト,8:00,6:00,10400,1950,2000,14350,0,0,0,0,0,0,5000,9350');
    expect(csv).toContain('電算機計算の特例');
  });

  it('formatMinutesAsHours', () => {
    expect(formatMinutesAsHours(435)).toBe('7:15');
    expect(formatMinutesAsHours(0)).toBe('0:00');
  });
});
