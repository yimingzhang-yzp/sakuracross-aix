/**
 * 必要人員テンプレートの展開と、確定シフトの差分判定用シグネチャ
 */
import { businessDateTimeToDate } from '@sakura-cross/business-date';

import type { StaffRole } from './types';

export interface TemplateRow {
  roleNeeded: StaffRole;
  /** 営業日基準 "HH:mm" */
  startTime: string;
  endTime: string;
  headcount: number;
}

export interface RequirementDraft {
  roleNeeded: StaffRole;
  startTime: Date;
  endTime: Date;
  headcount: number;
}

/**
 * テンプレート("20:00"〜"05:00" のような営業日基準の壁時計)を、
 * 指定営業日の絶対時刻に展開する。10:00 より前の時刻は翌暦日として解釈される。
 */
export function expandTemplates(businessDate: string, rows: TemplateRow[]): RequirementDraft[] {
  return rows
    .filter((row) => row.headcount > 0)
    .map((row) => {
      const startTime = businessDateTimeToDate(businessDate, row.startTime);
      const endTime = businessDateTimeToDate(businessDate, row.endTime);
      if (endTime <= startTime) {
        throw new RangeError(`テンプレートの終了時刻が開始時刻以前です: ${row.roleNeeded} ${row.startTime}〜${row.endTime}`);
      }
      return { roleNeeded: row.roleNeeded, startTime, endTime, headcount: row.headcount };
    });
}

/**
 * 確定シフトの通知差分判定に使う内容ハッシュ。
 * 前回通知時のシグネチャと一致すれば、本人へ再通知しない。
 */
export function assignmentSignature(a: {
  staffId: string;
  businessDayId: string;
  roleAssigned: string;
  plannedStart: Date;
  plannedEnd: Date;
  status: string;
}): string {
  return [a.staffId, a.businessDayId, a.roleAssigned, a.plannedStart.toISOString(), a.plannedEnd.toISOString(), a.status].join('|');
}
