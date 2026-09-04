import type { ShiftPayrollSettings } from '../settings';

export type StaffRole = 'RECEPTION' | 'BARTENDER' | 'BARBACK' | 'FLOOR_VIP' | 'CLOAK' | 'SECURITY' | 'MANAGER';
export type Availability = 'OK' | 'NG' | 'EARLY_ONLY' | 'LATE_ONLY';
export type EmploymentType = 'PART_TIME' | 'FULL_TIME' | 'CONTRACT';

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  RECEPTION: 'レセプション',
  BARTENDER: 'バーテンダー',
  BARBACK: 'バーバック',
  FLOOR_VIP: 'フロア/VIP',
  CLOAK: 'クローク',
  SECURITY: 'セキュリティ',
  MANAGER: 'マネージャー',
};

export const STAFF_ROLES = Object.keys(STAFF_ROLE_LABELS) as StaffRole[];

export interface SchedStaff {
  id: string;
  name: string;
  role: StaffRole;
  /** {"bartender": true} のように小文字の職種キーで兼務可能な職種を表す */
  skills: Record<string, unknown> | null;
  employmentType: EmploymentType;
  isMinor: boolean;
  hiredAt: Date | null;
  isActive: boolean;
}

export interface SchedRequirement {
  id: string;
  /** YYYY-MM-DD(営業日) */
  businessDate: string;
  role: StaffRole;
  start: Date;
  end: Date;
  headcount: number;
}

export interface SchedPreference {
  staffId: string;
  businessDate: string;
  availability: Availability;
}

export interface SchedAssignment {
  staffId: string;
  businessDate: string;
  role: StaffRole;
  start: Date;
  end: Date;
  requirementId?: string;
}

export interface GeneratedAssignment extends SchedAssignment {
  requirementId: string;
  /** 選定理由(デバッグ・管理画面表示用) */
  reason: string;
}

export type ExclusionReason =
  | 'inactive'
  | 'role_mismatch'
  | 'no_preference'
  | 'preference_ng'
  | 'preference_time'
  | 'minor_night'
  | 'same_day'
  | 'weekly_cap'
  | 'newcomer_alone';

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  inactive: '在籍外',
  role_mismatch: '職種不一致',
  no_preference: '希望未提出',
  preference_ng: '希望×',
  preference_time: '早番/遅番の時間帯外',
  minor_night: '未成年(22時以降不可)',
  same_day: '同日に既に割当あり',
  weekly_cap: '週上限超過',
  newcomer_alone: '新人単独(ベテラン不在)',
};

export interface Shortage {
  requirementId: string;
  businessDate: string;
  role: StaffRole;
  start: Date;
  end: Date;
  headcount: number;
  assigned: number;
  missing: number;
  exclusions: Partial<Record<ExclusionReason, number>>;
}

export type SchedSettings = Pick<
  ShiftPayrollSettings,
  'weeklyHoursCap' | 'weekStartsOn' | 'earlyShiftEnd' | 'lateShiftStart' | 'newcomerMonths' | 'minorNightStart' | 'nightEnd'
>;

export interface GenerateInput {
  requirements: SchedRequirement[];
  staff: SchedStaff[];
  preferences: SchedPreference[];
  /** 既存の割当(期間内の確定分・手動固定分・前後週の週上限計算用) */
  existingAssignments: SchedAssignment[];
  settings: SchedSettings;
  /** 新人判定の基準時刻 */
  now: Date;
  /** 公平性(今期割当時間)の集計対象期間 */
  periodStart: string;
  periodEnd: string;
}

export interface GenerateResult {
  assignments: GeneratedAssignment[];
  shortages: Shortage[];
  log: string[];
}
