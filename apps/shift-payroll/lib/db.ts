/**
 * DB アクセスの共通ヘルパー(設定値・監査ログ・確定期間)
 */

import { dbValueToBusinessDate } from '@sakura-cross/business-date';
import { type Prisma, getPrisma } from '@sakura-cross/shared-db';

import type { AdminSession } from './auth/session';
import type { FinalizedPeriod } from './payroll/compute';
import { DEFAULT_SETTINGS, SETTINGS_KEY, type ShiftPayrollSettings, parseSettings, shiftPayrollSettingsSchema } from './settings';

export const db = () => getPrisma();

export async function loadSettings(): Promise<ShiftPayrollSettings> {
  const row = await db().appSetting.findUnique({ where: { key: SETTINGS_KEY } });
  return row ? parseSettings(row.value) : DEFAULT_SETTINGS;
}

export async function saveSettings(input: unknown, actor: string): Promise<ShiftPayrollSettings> {
  const value = shiftPayrollSettingsSchema.parse(input);
  await db().appSetting.upsert({
    where: { key: SETTINGS_KEY },
    update: { value, updatedBy: actor },
    create: { key: SETTINGS_KEY, value, updatedBy: actor, description: 'シフト給与の業務パラメータ' },
  });
  return value;
}

export async function audit(
  session: Pick<AdminSession, 'userId' | 'name'>,
  action: string,
  targetType: string,
  targetId: string | null,
  detail?: Prisma.InputJsonValue,
): Promise<void> {
  await db().auditLog.create({
    data: { actorId: session.userId, actorName: session.name, action, targetType, targetId, detail },
  });
}

export async function finalizedPeriods(): Promise<FinalizedPeriod[]> {
  const runs = await db().payrollRun.findMany({ where: { status: 'FINALIZED' }, select: { id: true, periodStart: true, periodEnd: true } });
  return runs.map((r) => ({ id: r.id, periodStart: dbValueToBusinessDate(r.periodStart), periodEnd: dbValueToBusinessDate(r.periodEnd) }));
}
