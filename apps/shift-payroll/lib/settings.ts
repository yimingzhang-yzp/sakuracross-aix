/**
 * シフト給与の業務パラメータ(設定値)
 *
 * 時給・締め日・丸め・休憩・深夜割増・週上限などはすべてここで定義し、
 * DB の AppSetting(key = SETTINGS_KEY)に JSON で保存する。コード内にハードコードしない。
 * 未保存の項目は DEFAULT_SETTINGS で補完される。
 */
import { z } from 'zod';

export const SETTINGS_KEY = 'shift_payroll.settings';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm 形式で入力してください');

export const shiftPayrollSettingsSchema = z.object({
  /** 新規スタッフ登録時の既定時給(円) */
  defaultHourlyWage: z.coerce.number().int().min(0).default(1300),
  /** 週の割当上限(時間) */
  weeklyHoursCap: z.coerce.number().min(0).default(40),
  /** 週の開始曜日(0=日 … 1=月 … 6=土) */
  weekStartsOn: z.coerce.number().int().min(0).max(6).default(1),
  /** 打刻の丸め単位(分)。0 = 丸めなし */
  roundingMinutes: z.coerce.number().int().refine((v) => [0, 5, 10, 15, 30].includes(v), '0/5/10/15/30 のいずれか').default(0),
  /**
   * 丸め方向
   * - favor_worker: 出勤は早い方へ、退勤は遅い方へ(労働者有利。既定)
   * - nearest: 最も近い単位へ
   * - strict: 出勤は遅い方へ、退勤は早い方へ(労働者不利。非推奨)
   */
  roundingMode: z.enum(['favor_worker', 'nearest', 'strict']).default('favor_worker'),
  /** 休憩未入力時の自動控除を有効にする */
  autoBreakEnabled: z.coerce.boolean().default(true),
  /** 実労働が overMinutes を超えたら breakMinutes を控除(大きい方を優先) */
  autoBreakRules: z
    .array(z.object({ overMinutes: z.coerce.number().int().min(0), breakMinutes: z.coerce.number().int().min(0) }))
    .default([
      { overMinutes: 360, breakMinutes: 45 },
      { overMinutes: 480, breakMinutes: 60 },
    ]),
  /** 深夜割増率(0.25 = 25%) */
  nightPremiumRate: z.coerce.number().min(0).default(0.25),
  /** 深夜時間帯の開始(営業日基準の壁時計) */
  nightStart: hhmm.default('22:00'),
  /** 深夜時間帯の終了(翌朝) */
  nightEnd: hhmm.default('05:00'),
  /** 給与締め日。'EOM' = 月末締め、数値 = その日締め(翌日〜翌月同日) */
  payrollClosingDay: z.union([z.literal('EOM'), z.coerce.number().int().min(1).max(28)]).default('EOM'),
  /** 円未満の端数処理 */
  yenRounding: z.enum(['floor_daily', 'floor_monthly', 'round_daily']).default('floor_daily'),
  /** 欠員募集の確定方式 */
  openShiftMode: z.enum(['FIRST_COME', 'MANAGER_APPROVAL']).default('FIRST_COME'),
  /** 「早番のみ」= この時刻までに終わるスロット */
  earlyShiftEnd: hhmm.default('01:00'),
  /** 「遅番のみ」= この時刻以降に始まるスロット */
  lateShiftStart: hhmm.default('00:00'),
  /** 新人判定(入店からこの月数未満) */
  newcomerMonths: z.coerce.number().int().min(0).default(3),
  /** 未成年が働けない時間帯(この時刻から nightEnd まで) */
  minorNightStart: hhmm.default('22:00'),
  /** 希望提出リマインドを送る「締切の N 日前」(0 = 締切当日) */
  preferenceReminderDaysBefore: z.array(z.coerce.number().int().min(0)).default([2, 0]),
  /** 給与 CSV の文字コード */
  csvEncoding: z.enum(['utf8-bom', 'sjis']).default('utf8-bom'),
  /** 欠員募集の応募受付期限(募集開始から N 時間。0 = 無期限) */
  openShiftExpireHours: z.coerce.number().int().min(0).default(0),
  /** 定休日の曜日(0=日 … 6=土)。カレンダーの一括作成で自動的に「休業」になる */
  closedWeekdays: z.array(z.coerce.number().int().min(0).max(6)).default([0, 1]),
  /** 週末営業の曜日(0=日 … 6=土)。一括作成で自動的に「週末営業」になる(定休日が優先) */
  weekendWeekdays: z.array(z.coerce.number().int().min(0).max(6)).default([5, 6, 0]),
  /** 健康保険料率(労使合計。協会けんぽ 東京支部 令和7年度 9.91%) */
  healthInsuranceRate: z.coerce.number().min(0).max(1).default(0.0991),
  /** 介護保険料率(労使合計。40〜64歳の被保険者。令和7年度 1.59%) */
  careInsuranceRate: z.coerce.number().min(0).max(1).default(0.0159),
  /** 厚生年金保険料率(労使合計 18.3%) */
  pensionInsuranceRate: z.coerce.number().min(0).max(1).default(0.183),
  /** 雇用保険料率(被保険者負担分。一般の事業 令和7年度 0.55%) */
  employmentInsuranceWorkerRate: z.coerce.number().min(0).max(1).default(0.0055),
});

export type ShiftPayrollSettings = z.infer<typeof shiftPayrollSettingsSchema>;

export const DEFAULT_SETTINGS: ShiftPayrollSettings = shiftPayrollSettingsSchema.parse({});

/**
 * DB から読んだ JSON を設定値に正規化する。壊れた値は既定値で補完し、例外にしない。
 */
export function parseSettings(raw: unknown): ShiftPayrollSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}) };
  const result = shiftPayrollSettingsSchema.safeParse(merged);
  if (result.success) return result.data;
  // 一部の項目だけ壊れている場合は、その項目のみ既定値へ戻す
  const repaired: Record<string, unknown> = { ...merged };
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && key in DEFAULT_SETTINGS) {
      repaired[key] = (DEFAULT_SETTINGS as Record<string, unknown>)[key];
    }
  }
  return shiftPayrollSettingsSchema.parse(repaired);
}

/** 設定項目の日本語ラベル(設定画面・スナップショット表示用) */
export const SETTING_LABELS: Record<keyof ShiftPayrollSettings, string> = {
  defaultHourlyWage: '既定時給(円)',
  weeklyHoursCap: '週の割当上限(時間)',
  weekStartsOn: '週の開始曜日',
  roundingMinutes: '打刻の丸め単位(分)',
  roundingMode: '丸め方向',
  autoBreakEnabled: '休憩の自動控除',
  autoBreakRules: '自動控除ルール',
  nightPremiumRate: '深夜割増率',
  nightStart: '深夜開始',
  nightEnd: '深夜終了',
  payrollClosingDay: '給与締め日',
  yenRounding: '円未満の端数処理',
  openShiftMode: '欠員募集の確定方式',
  earlyShiftEnd: '早番の終了時刻',
  lateShiftStart: '遅番の開始時刻',
  newcomerMonths: '新人判定(月数)',
  minorNightStart: '未成年の勤務禁止開始時刻',
  preferenceReminderDaysBefore: 'リマインド(締切の N 日前)',
  csvEncoding: 'CSV 文字コード',
  openShiftExpireHours: '募集の受付期限(時間)',
  closedWeekdays: '定休日の曜日',
  weekendWeekdays: '週末営業の曜日',
  healthInsuranceRate: '健康保険料率(労使合計)',
  careInsuranceRate: '介護保険料率(労使合計)',
  pensionInsuranceRate: '厚生年金保険料率(労使合計)',
  employmentInsuranceWorkerRate: '雇用保険料率(本人負担)',
};
