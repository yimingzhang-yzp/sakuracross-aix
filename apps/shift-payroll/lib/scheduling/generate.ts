/**
 * シフト自動生成(貪欲法・純関数)— 指示書 01 §5.3
 *
 * 1. 各営業日×職種の必要人数スロットを、充足難易度が高い順(候補者が少ない順)に処理
 * 2. 割当候補 = 職種適合 かつ 希望○(または該当時間帯 OK) かつ 同日未割当
 * 3. 優先度スコア = (FULL_TIME なら +8h) − 今期の割当時間(公平性)
 * 4. 制約: 未成年は 22:00 以降不可 / 同日重複禁止 / 週上限 / 新人はベテラン同席時のみ
 * 5. 埋まらなかったスロットは「不足」として理由付きで返す
 *
 * 新人制約は 2 パスで処理する(1 パス目でベテランを配置し、2 パス目で新人を追加)。
 * 結果は入力が同じなら常に同じ(決定的)。
 */
import { addBusinessDays, businessDateTimeToDate } from '@sakura-cross/business-date';

import type {
  ExclusionReason,
  GenerateInput,
  GenerateResult,
  GeneratedAssignment,
  SchedAssignment,
  SchedRequirement,
  SchedSettings,
  SchedStaff,
  Shortage,
  StaffRole,
} from './types';

const MINUTE_MS = 60_000;
/** 社員優先のボーナス(分)。これ以上多く入っている社員よりアルバイトを優先する */
const FULL_TIME_BONUS_MINUTES = 480;

// -----------------------------------------------------------------------------
// 判定ヘルパー(個別にテスト可能)
// -----------------------------------------------------------------------------

export function staffCanWorkRole(staff: Pick<SchedStaff, 'role' | 'skills'>, role: StaffRole): boolean {
  if (staff.role === role) return true;
  const skills = staff.skills;
  if (!skills || typeof skills !== 'object') return false;
  return skills[role.toLowerCase()] === true;
}

/** 入店 newcomerMonths 未満なら新人。hiredAt 空はベテラン扱い */
export function isNewcomer(staff: Pick<SchedStaff, 'hiredAt'>, now: Date, newcomerMonths: number): boolean {
  if (!staff.hiredAt) return false;
  const threshold = new Date(
    Date.UTC(
      staff.hiredAt.getUTCFullYear(),
      staff.hiredAt.getUTCMonth() + newcomerMonths,
      staff.hiredAt.getUTCDate(),
      staff.hiredAt.getUTCHours(),
      staff.hiredAt.getUTCMinutes(),
    ),
  );
  return now < threshold;
}

export function durationMinutes(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / MINUTE_MS));
}

export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** 営業日が属する週の開始日(YYYY-MM-DD)。weekStartsOn: 0=日 … 6=土 */
export function weekStartOf(businessDate: string, weekStartsOn: number): string {
  const day = new Date(`${businessDate}T00:00:00.000Z`).getUTCDay();
  const diff = (day - weekStartsOn + 7) % 7;
  return addBusinessDays(businessDate, -diff);
}

/** 未成年の勤務禁止時間帯 [minorNightStart, nightEnd) と重なるか */
export function overlapsMinorNight(req: Pick<SchedRequirement, 'businessDate' | 'start' | 'end'>, settings: SchedSettings): boolean {
  const start = businessDateTimeToDate(req.businessDate, settings.minorNightStart);
  let end = businessDateTimeToDate(req.businessDate, settings.nightEnd);
  if (end <= start) end = businessDateTimeToDate(addBusinessDays(req.businessDate, 1), settings.nightEnd);
  return intervalsOverlap(req.start, req.end, start, end);
}

/** 希望(○ / 早番のみ / 遅番のみ)がスロットの時間帯を許容するか */
export function preferenceAllows(
  availability: 'OK' | 'EARLY_ONLY' | 'LATE_ONLY',
  req: Pick<SchedRequirement, 'businessDate' | 'start' | 'end'>,
  settings: SchedSettings,
): boolean {
  switch (availability) {
    case 'OK':
      return true;
    case 'EARLY_ONLY':
      return req.end <= businessDateTimeToDate(req.businessDate, settings.earlyShiftEnd);
    case 'LATE_ONLY':
      return req.start >= businessDateTimeToDate(req.businessDate, settings.lateShiftStart);
    default:
      return false;
  }
}

// -----------------------------------------------------------------------------
// 内部状態
// -----------------------------------------------------------------------------

interface State {
  /** staffId → 割当一覧(既存 + 新規) */
  byStaff: Map<string, SchedAssignment[]>;
  /** staffId → 今期の割当分数 */
  periodMinutes: Map<string, number>;
  /** staffId → 割当件数(同点時のタイブレーク) */
  count: Map<string, number>;
}

function addToState(state: State, a: SchedAssignment, input: GenerateInput): void {
  const list = state.byStaff.get(a.staffId) ?? [];
  list.push(a);
  state.byStaff.set(a.staffId, list);
  if (a.businessDate >= input.periodStart && a.businessDate <= input.periodEnd) {
    state.periodMinutes.set(a.staffId, (state.periodMinutes.get(a.staffId) ?? 0) + durationMinutes(a.start, a.end));
    state.count.set(a.staffId, (state.count.get(a.staffId) ?? 0) + 1);
  }
}

function weeklyMinutes(state: State, staffId: string, businessDate: string, weekStartsOn: number): number {
  const weekStart = weekStartOf(businessDate, weekStartsOn);
  const weekEnd = addBusinessDays(weekStart, 6);
  let total = 0;
  for (const a of state.byStaff.get(staffId) ?? []) {
    if (a.businessDate >= weekStart && a.businessDate <= weekEnd) total += durationMinutes(a.start, a.end);
  }
  return total;
}

type Evaluation = { ok: true; score: number } | { ok: false; reason: ExclusionReason };

function evaluate(
  staff: SchedStaff,
  req: SchedRequirement,
  input: GenerateInput,
  state: State,
  prefIndex: Map<string, GenerateInput['preferences'][number]>,
  newcomerIds: Set<string>,
  allowNewcomer: boolean,
): Evaluation {
  if (!staff.isActive) return { ok: false, reason: 'inactive' };
  if (!staffCanWorkRole(staff, req.role)) return { ok: false, reason: 'role_mismatch' };

  const pref = prefIndex.get(`${staff.id}|${req.businessDate}`);
  if (!pref) return { ok: false, reason: 'no_preference' };
  if (pref.availability === 'NG') return { ok: false, reason: 'preference_ng' };
  if (!preferenceAllows(pref.availability, req, input.settings)) return { ok: false, reason: 'preference_time' };

  if (staff.isMinor && overlapsMinorNight(req, input.settings)) return { ok: false, reason: 'minor_night' };

  const own = state.byStaff.get(staff.id) ?? [];
  if (own.some((a) => a.businessDate === req.businessDate)) return { ok: false, reason: 'same_day' };

  const cap = input.settings.weeklyHoursCap;
  if (cap > 0) {
    const used = weeklyMinutes(state, staff.id, req.businessDate, input.settings.weekStartsOn);
    if (used + durationMinutes(req.start, req.end) > cap * 60) return { ok: false, reason: 'weekly_cap' };
  }

  if (newcomerIds.has(staff.id)) {
    if (!allowNewcomer) return { ok: false, reason: 'newcomer_alone' };
    const veteranPresent = [...state.byStaff.entries()].some(
      ([otherId, list]) =>
        otherId !== staff.id &&
        !newcomerIds.has(otherId) &&
        list.some((a) => a.businessDate === req.businessDate && intervalsOverlap(a.start, a.end, req.start, req.end)),
    );
    if (!veteranPresent) return { ok: false, reason: 'newcomer_alone' };
  }

  const bonus = staff.employmentType === 'FULL_TIME' ? FULL_TIME_BONUS_MINUTES : 0;
  const score = bonus - (state.periodMinutes.get(staff.id) ?? 0);
  return { ok: true, score };
}

function compareCandidates(
  a: { staff: SchedStaff; score: number },
  b: { staff: SchedStaff; score: number },
  state: State,
): number {
  if (b.score !== a.score) return b.score - a.score;
  const ca = state.count.get(a.staff.id) ?? 0;
  const cb = state.count.get(b.staff.id) ?? 0;
  if (ca !== cb) return ca - cb;
  const byName = a.staff.name.localeCompare(b.staff.name, 'ja');
  if (byName !== 0) return byName;
  return a.staff.id.localeCompare(b.staff.id);
}

// -----------------------------------------------------------------------------
// メイン
// -----------------------------------------------------------------------------

export function generateShifts(input: GenerateInput): GenerateResult {
  const log: string[] = [];
  const state: State = { byStaff: new Map(), periodMinutes: new Map(), count: new Map() };
  for (const a of input.existingAssignments) addToState(state, a, input);

  const prefIndex = new Map(input.preferences.map((p) => [`${p.staffId}|${p.businessDate}`, p]));
  const newcomerIds = new Set(
    input.staff.filter((s) => isNewcomer(s, input.now, input.settings.newcomerMonths)).map((s) => s.id),
  );

  // 充足難易度: 静的な候補数(職種・希望・未成年のみで判定)が少ない順
  const staticCandidateCount = (req: SchedRequirement): number =>
    input.staff.filter((s) => {
      if (!s.isActive || !staffCanWorkRole(s, req.role)) return false;
      const pref = prefIndex.get(`${s.id}|${req.businessDate}`);
      if (!pref || pref.availability === 'NG' || !preferenceAllows(pref.availability, req, input.settings)) return false;
      if (s.isMinor && overlapsMinorNight(req, input.settings)) return false;
      return true;
    }).length;

  const ordered = [...input.requirements].sort((a, b) => {
    const diff = staticCandidateCount(a) - staticCandidateCount(b);
    if (diff !== 0) return diff;
    if (a.businessDate !== b.businessDate) return a.businessDate.localeCompare(b.businessDate);
    if (a.start.getTime() !== b.start.getTime()) return a.start.getTime() - b.start.getTime();
    return a.role.localeCompare(b.role);
  });

  const remaining = new Map(ordered.map((r) => [r.id, r.headcount]));
  const assignments: GeneratedAssignment[] = [];

  for (const pass of [1, 2] as const) {
    const allowNewcomer = pass === 2;
    for (const req of ordered) {
      while ((remaining.get(req.id) ?? 0) > 0) {
        const candidates: { staff: SchedStaff; score: number }[] = [];
        for (const staff of input.staff) {
          const ev = evaluate(staff, req, input, state, prefIndex, newcomerIds, allowNewcomer);
          if (ev.ok) candidates.push({ staff, score: ev.score });
        }
        if (candidates.length === 0) break;
        candidates.sort((a, b) => compareCandidates(a, b, state));
        const chosen = candidates[0]!;
        const assignment: GeneratedAssignment = {
          requirementId: req.id,
          staffId: chosen.staff.id,
          businessDate: req.businessDate,
          role: req.role,
          start: req.start,
          end: req.end,
          reason: `pass${pass} score=${chosen.score} candidates=${candidates.length}`,
        };
        assignments.push(assignment);
        addToState(state, assignment, input);
        remaining.set(req.id, (remaining.get(req.id) ?? 0) - 1);
        log.push(`${req.businessDate} ${req.role}: ${chosen.staff.name} を割当(${assignment.reason})`);
      }
    }
  }

  const shortages: Shortage[] = [];
  for (const req of ordered) {
    const missing = remaining.get(req.id) ?? 0;
    if (missing <= 0) continue;
    const exclusions: Partial<Record<ExclusionReason, number>> = {};
    for (const staff of input.staff) {
      const ev = evaluate(staff, req, input, state, prefIndex, newcomerIds, true);
      if (!ev.ok) exclusions[ev.reason] = (exclusions[ev.reason] ?? 0) + 1;
    }
    shortages.push({
      requirementId: req.id,
      businessDate: req.businessDate,
      role: req.role,
      start: req.start,
      end: req.end,
      headcount: req.headcount,
      assigned: req.headcount - missing,
      missing,
      exclusions,
    });
    log.push(`${req.businessDate} ${req.role}: ${missing} 名不足`);
  }

  // 出力は日付・開始・職種・スタッフ名順で安定させる
  const nameOf = new Map(input.staff.map((s) => [s.id, s.name]));
  assignments.sort(
    (a, b) =>
      a.businessDate.localeCompare(b.businessDate) ||
      a.start.getTime() - b.start.getTime() ||
      a.role.localeCompare(b.role) ||
      (nameOf.get(a.staffId) ?? '').localeCompare(nameOf.get(b.staffId) ?? '', 'ja'),
  );
  shortages.sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.start.getTime() - b.start.getTime());

  return { assignments, shortages, log };
}
