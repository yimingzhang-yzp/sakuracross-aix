import { describe, expect, it } from 'vitest';

import {
  generateShifts,
  isNewcomer,
  overlapsMinorNight,
  preferenceAllows,
  staffCanWorkRole,
  weekStartOf,
} from '../lib/scheduling/generate';
import { assignmentSignature, expandTemplates } from '../lib/scheduling/templates';
import type { GenerateInput, SchedPreference, SchedRequirement, SchedStaff } from '../lib/scheduling/types';
import { DEFAULT_SETTINGS } from '../lib/settings';

const jst = (iso: string) => new Date(`${iso}+09:00`);
const NOW = jst('2025-01-05T12:00:00');
const settings = DEFAULT_SETTINGS;

function staff(partial: Partial<SchedStaff> & { id: string; name: string }): SchedStaff {
  return {
    role: 'BARTENDER',
    skills: null,
    employmentType: 'PART_TIME',
    isMinor: false,
    hiredAt: jst('2023-01-01T00:00:00'),
    isActive: true,
    ...partial,
  };
}

/** 営業日 date の 20:00〜翌5:00 のスロット */
function req(id: string, date: string, role: SchedStaff['role'] = 'BARTENDER', headcount = 1, start = '20:00', end = '05:00'): SchedRequirement {
  const startDate = jst(`${date}T${start}:00`);
  const endDate = end < '10:00' ? jst(`${nextDay(date)}T${end}:00`) : jst(`${date}T${end}:00`);
  return { id, businessDate: date, role, start: startDate, end: endDate, headcount };
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function ok(staffId: string, ...dates: string[]): SchedPreference[] {
  return dates.map((businessDate) => ({ staffId, businessDate, availability: 'OK' as const }));
}

function input(partial: Partial<GenerateInput>): GenerateInput {
  return {
    requirements: [],
    staff: [],
    preferences: [],
    existingAssignments: [],
    settings,
    now: NOW,
    periodStart: '2025-01-01',
    periodEnd: '2025-01-15',
    ...partial,
  };
}

describe('未成年制約', () => {
  it('未成年は 22:00 以降を含むスロットに割り当てられない → 不足として検出', () => {
    const minor = staff({ id: 'minor', name: '未成年', isMinor: true });
    const result = generateShifts(
      input({ requirements: [req('r1', '2025-01-10')], staff: [minor], preferences: ok('minor', '2025-01-10') }),
    );
    expect(result.assignments).toHaveLength(0);
    expect(result.shortages).toHaveLength(1);
    expect(result.shortages[0]!.exclusions.minor_night).toBe(1);
  });

  it('未成年でも 22:00 前に終わるスロットには割当可', () => {
    const minor = staff({ id: 'minor', name: '未成年', isMinor: true });
    const result = generateShifts(
      input({
        requirements: [req('r1', '2025-01-10', 'BARTENDER', 1, '18:00', '21:30')],
        staff: [minor],
        preferences: ok('minor', '2025-01-10'),
      }),
    );
    expect(result.assignments.map((a) => a.staffId)).toEqual(['minor']);
  });

  it('overlapsMinorNight は境界を正しく扱う(22:00 ちょうど終了は不可ではない)', () => {
    expect(overlapsMinorNight({ businessDate: '2025-01-10', start: jst('2025-01-10T20:00:00'), end: jst('2025-01-10T22:00:00') }, settings)).toBe(false);
    expect(overlapsMinorNight({ businessDate: '2025-01-10', start: jst('2025-01-10T20:00:00'), end: jst('2025-01-10T22:01:00') }, settings)).toBe(true);
    expect(overlapsMinorNight({ businessDate: '2025-01-10', start: jst('2025-01-11T05:00:00'), end: jst('2025-01-11T09:00:00') }, settings)).toBe(false);
  });
});

describe('新人×ベテラン制約', () => {
  const newcomer = staff({ id: 'new', name: '新人', hiredAt: jst('2024-12-01T00:00:00') });
  const veteran = staff({ id: 'vet', name: 'ベテラン', hiredAt: jst('2020-01-01T00:00:00') });

  it('新人しか候補がいないスロットは不足(新人単独)', () => {
    const result = generateShifts(
      input({ requirements: [req('r1', '2025-01-10')], staff: [newcomer], preferences: ok('new', '2025-01-10') }),
    );
    expect(result.assignments).toHaveLength(0);
    expect(result.shortages[0]!.exclusions.newcomer_alone).toBe(1);
  });

  it('同じ時間帯にベテランが割り当てられれば 2 パス目で新人も入る', () => {
    const result = generateShifts(
      input({
        requirements: [req('r1', '2025-01-10', 'BARTENDER', 2)],
        staff: [newcomer, veteran],
        preferences: [...ok('new', '2025-01-10'), ...ok('vet', '2025-01-10')],
      }),
    );
    expect(result.assignments.map((a) => a.staffId).sort()).toEqual(['new', 'vet']);
    expect(result.assignments.find((a) => a.staffId === 'new')!.reason).toContain('pass2');
    expect(result.shortages).toHaveLength(0);
  });

  it('ベテランが別の時間帯(重ならない)にしかいない場合は新人を入れない', () => {
    const result = generateShifts(
      input({
        requirements: [req('early', '2025-01-10', 'BARTENDER', 1, '18:00', '20:00'), req('late', '2025-01-10', 'BARTENDER', 1, '20:00', '05:00')],
        staff: [newcomer, veteran],
        preferences: [...ok('new', '2025-01-10'), ...ok('vet', '2025-01-10')],
      }),
    );
    // ベテランは 1 日 1 スロットのみ。もう一方に新人は単独になるため入らない
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]!.staffId).toBe('vet');
    expect(result.shortages).toHaveLength(1);
    expect(result.shortages[0]!.exclusions.newcomer_alone).toBe(1);
  });

  it('既存の確定割当にベテランがいれば 1 パス目から新人を入れられる', () => {
    const result = generateShifts(
      input({
        requirements: [req('r1', '2025-01-10')],
        staff: [newcomer, veteran],
        preferences: ok('new', '2025-01-10'),
        existingAssignments: [
          { staffId: 'vet', businessDate: '2025-01-10', role: 'SECURITY', start: jst('2025-01-10T20:00:00'), end: jst('2025-01-11T05:00:00') },
        ],
      }),
    );
    expect(result.assignments.map((a) => a.staffId)).toEqual(['new']);
  });

  it('isNewcomer: 入店 3 ヶ月未満のみ新人。hiredAt 空はベテラン', () => {
    expect(isNewcomer({ hiredAt: jst('2024-12-01T00:00:00') }, NOW, 3)).toBe(true);
    expect(isNewcomer({ hiredAt: jst('2024-10-05T12:00:00') }, NOW, 3)).toBe(false);
    expect(isNewcomer({ hiredAt: null }, NOW, 3)).toBe(false);
  });
});

describe('公平性と社員優先', () => {
  it('今期の割当時間が少ないスタッフが優先される', () => {
    const a = staff({ id: 'a', name: 'A' });
    const b = staff({ id: 'b', name: 'B' });
    const result = generateShifts(
      input({
        requirements: [req('r1', '2025-01-10')],
        staff: [a, b],
        preferences: [...ok('a', '2025-01-10'), ...ok('b', '2025-01-10')],
        existingAssignments: [
          { staffId: 'a', businessDate: '2025-01-03', role: 'BARTENDER', start: jst('2025-01-03T20:00:00'), end: jst('2025-01-04T04:00:00') },
        ],
      }),
    );
    expect(result.assignments[0]!.staffId).toBe('b');
  });

  it('複数日では割当が分散する(同じ人に偏らない)', () => {
    const a = staff({ id: 'a', name: 'A' });
    const b = staff({ id: 'b', name: 'B' });
    const dates = ['2025-01-10', '2025-01-11', '2025-01-12', '2025-01-13'];
    const result = generateShifts(
      input({
        requirements: dates.map((d, i) => req(`r${i}`, d)),
        staff: [a, b],
        preferences: [...ok('a', ...dates), ...ok('b', ...dates)],
      }),
    );
    const countA = result.assignments.filter((x) => x.staffId === 'a').length;
    const countB = result.assignments.filter((x) => x.staffId === 'b').length;
    expect(countA).toBe(2);
    expect(countB).toBe(2);
  });

  it('同じ割当時間なら FULL_TIME を優先', () => {
    const part = staff({ id: 'part', name: 'アルバイト' });
    const full = staff({ id: 'full', name: '社員', employmentType: 'FULL_TIME' });
    const result = generateShifts(
      input({ requirements: [req('r1', '2025-01-10')], staff: [part, full], preferences: [...ok('part', '2025-01-10'), ...ok('full', '2025-01-10')] }),
    );
    expect(result.assignments[0]!.staffId).toBe('full');
  });

  it('社員が既に 8 時間以上多く入っていればアルバイトを優先(公平性との両立)', () => {
    const part = staff({ id: 'part', name: 'アルバイト' });
    const full = staff({ id: 'full', name: '社員', employmentType: 'FULL_TIME' });
    const result = generateShifts(
      input({
        requirements: [req('r1', '2025-01-10')],
        staff: [part, full],
        preferences: [...ok('part', '2025-01-10'), ...ok('full', '2025-01-10')],
        existingAssignments: [
          { staffId: 'full', businessDate: '2025-01-03', role: 'BARTENDER', start: jst('2025-01-03T20:00:00'), end: jst('2025-01-04T05:00:00') },
        ],
      }),
    );
    expect(result.assignments[0]!.staffId).toBe('part');
  });
});

describe('希望・職種・重複・週上限', () => {
  it('希望未提出・希望×は候補外', () => {
    const a = staff({ id: 'a', name: 'A' });
    const b = staff({ id: 'b', name: 'B' });
    const result = generateShifts(
      input({
        requirements: [req('r1', '2025-01-10')],
        staff: [a, b],
        preferences: [{ staffId: 'b', businessDate: '2025-01-10', availability: 'NG' }],
      }),
    );
    expect(result.assignments).toHaveLength(0);
    expect(result.shortages[0]!.exclusions).toMatchObject({ no_preference: 1, preference_ng: 1 });
  });

  it('早番のみ: 翌1:00 までに終わるスロットだけ可', () => {
    const early = { businessDate: '2025-01-10', start: jst('2025-01-10T20:00:00'), end: jst('2025-01-11T01:00:00') };
    const late = { businessDate: '2025-01-10', start: jst('2025-01-10T20:00:00'), end: jst('2025-01-11T05:00:00') };
    expect(preferenceAllows('EARLY_ONLY', early, settings)).toBe(true);
    expect(preferenceAllows('EARLY_ONLY', late, settings)).toBe(false);
  });

  it('遅番のみ: 翌0:00 以降に始まるスロットだけ可', () => {
    const late = { businessDate: '2025-01-10', start: jst('2025-01-11T00:00:00'), end: jst('2025-01-11T05:00:00') };
    const full = { businessDate: '2025-01-10', start: jst('2025-01-10T20:00:00'), end: jst('2025-01-11T05:00:00') };
    expect(preferenceAllows('LATE_ONLY', late, settings)).toBe(true);
    expect(preferenceAllows('LATE_ONLY', full, settings)).toBe(false);
  });

  it('skills で兼務できる職種にも入れる', () => {
    const barback = staff({ id: 'bb', name: 'バーバック', role: 'BARBACK', skills: { bartender: true } });
    expect(staffCanWorkRole(barback, 'BARTENDER')).toBe(true);
    expect(staffCanWorkRole(barback, 'SECURITY')).toBe(false);
    const result = generateShifts(
      input({ requirements: [req('r1', '2025-01-10', 'BARTENDER')], staff: [barback], preferences: ok('bb', '2025-01-10') }),
    );
    expect(result.assignments[0]!.staffId).toBe('bb');
  });

  it('同一人物は同じ営業日に 2 つのスロットへ入らない', () => {
    const a = staff({ id: 'a', name: 'A', skills: { security: true } });
    const result = generateShifts(
      input({
        requirements: [req('r1', '2025-01-10', 'BARTENDER'), req('r2', '2025-01-10', 'SECURITY')],
        staff: [a],
        preferences: ok('a', '2025-01-10'),
      }),
    );
    expect(result.assignments).toHaveLength(1);
    expect(result.shortages).toHaveLength(1);
    expect(result.shortages[0]!.exclusions.same_day).toBe(1);
  });

  it('週上限(40h)を超える割当はしない', () => {
    const a = staff({ id: 'a', name: 'A' });
    // 月〜木で 9h × 4 = 36h 既存。金曜 9h は 45h になるため不可
    const existing = ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09'].map((d) => ({
      staffId: 'a',
      businessDate: d,
      role: 'BARTENDER' as const,
      start: jst(`${d}T20:00:00`),
      end: jst(`${nextDay(d)}T05:00:00`),
    }));
    const result = generateShifts(
      input({ requirements: [req('r1', '2025-01-10')], staff: [a], preferences: ok('a', '2025-01-10'), existingAssignments: existing }),
    );
    expect(result.assignments).toHaveLength(0);
    expect(result.shortages[0]!.exclusions.weekly_cap).toBe(1);
  });

  it('週の開始日は設定(月曜)に従う', () => {
    expect(weekStartOf('2025-01-10', 1)).toBe('2025-01-06'); // 金 → 月
    expect(weekStartOf('2025-01-12', 1)).toBe('2025-01-06'); // 日 → 前の月
    expect(weekStartOf('2025-01-12', 0)).toBe('2025-01-12'); // 日曜開始
  });

  it('週上限 0 は無制限', () => {
    const a = staff({ id: 'a', name: 'A' });
    const existing = ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09'].map((d) => ({
      staffId: 'a',
      businessDate: d,
      role: 'BARTENDER' as const,
      start: jst(`${d}T20:00:00`),
      end: jst(`${nextDay(d)}T05:00:00`),
    }));
    const result = generateShifts(
      input({
        requirements: [req('r1', '2025-01-10')],
        staff: [a],
        preferences: ok('a', '2025-01-10'),
        existingAssignments: existing,
        settings: { ...settings, weeklyHoursCap: 0 },
      }),
    );
    expect(result.assignments).toHaveLength(1);
  });
});

describe('充足不能スロットの検出と難易度順', () => {
  it('headcount のうち埋まらなかった人数を missing として返す', () => {
    const a = staff({ id: 'a', name: 'A' });
    const result = generateShifts(
      input({ requirements: [req('r1', '2025-01-10', 'BARTENDER', 3)], staff: [a], preferences: ok('a', '2025-01-10') }),
    );
    expect(result.assignments).toHaveLength(1);
    expect(result.shortages[0]).toMatchObject({ headcount: 3, assigned: 1, missing: 2 });
  });

  it('候補が少ないスロットを先に処理する(希少人材を取り合わない)', () => {
    // sec は SECURITY 専任、multi は両方できる。SECURITY 枠を先に埋めないと multi が取られて SECURITY が不足する
    const sec = staff({ id: 'sec', name: 'セキュ', role: 'SECURITY' });
    const multi = staff({ id: 'multi', name: '兼務', role: 'BARTENDER', skills: { security: true } });
    const result = generateShifts(
      input({
        requirements: [req('bar', '2025-01-10', 'BARTENDER'), req('sec', '2025-01-10', 'SECURITY')],
        staff: [multi, sec],
        preferences: [...ok('sec', '2025-01-10'), ...ok('multi', '2025-01-10')],
      }),
    );
    expect(result.shortages).toHaveLength(0);
    expect(result.assignments.find((x) => x.role === 'SECURITY')!.staffId).toBe('sec');
    expect(result.assignments.find((x) => x.role === 'BARTENDER')!.staffId).toBe('multi');
  });

  it('同じ入力なら同じ出力(決定的)', () => {
    const staffList = ['a', 'b', 'c', 'd'].map((id) => staff({ id, name: id.toUpperCase() }));
    const dates = ['2025-01-10', '2025-01-11', '2025-01-12'];
    const inp = input({
      requirements: dates.map((d, i) => req(`r${i}`, d, 'BARTENDER', 2)),
      staff: staffList,
      preferences: staffList.flatMap((s) => ok(s.id, ...dates)),
    });
    const first = generateShifts(inp);
    const second = generateShifts(inp);
    expect(second.assignments).toEqual(first.assignments);
  });
});

describe('テンプレート展開・シグネチャ', () => {
  it('20:00〜05:00 は翌暦日の 5:00 に展開される', () => {
    const [r] = expandTemplates('2025-01-10', [{ roleNeeded: 'BARTENDER', startTime: '20:00', endTime: '05:00', headcount: 2 }]);
    expect(r!.startTime).toEqual(jst('2025-01-10T20:00:00'));
    expect(r!.endTime).toEqual(jst('2025-01-11T05:00:00'));
    expect(r!.headcount).toBe(2);
  });

  it('headcount 0 の行は除外、終了が開始以前なら例外', () => {
    expect(expandTemplates('2025-01-10', [{ roleNeeded: 'CLOAK', startTime: '20:00', endTime: '05:00', headcount: 0 }])).toEqual([]);
    expect(() => expandTemplates('2025-01-10', [{ roleNeeded: 'CLOAK', startTime: '20:00', endTime: '19:00', headcount: 1 }])).toThrow(RangeError);
  });

  it('assignmentSignature は内容が同じなら一致、変われば変わる', () => {
    const base = {
      staffId: 's',
      businessDayId: 'd',
      roleAssigned: 'BARTENDER',
      plannedStart: jst('2025-01-10T20:00:00'),
      plannedEnd: jst('2025-01-11T05:00:00'),
      status: 'CONFIRMED',
    };
    expect(assignmentSignature(base)).toBe(assignmentSignature({ ...base }));
    expect(assignmentSignature(base)).not.toBe(assignmentSignature({ ...base, plannedEnd: jst('2025-01-11T04:00:00') }));
    expect(assignmentSignature(base)).not.toBe(assignmentSignature({ ...base, status: 'CANCELLED' }));
  });
});
