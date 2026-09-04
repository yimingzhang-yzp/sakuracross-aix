'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/auth/session';
import { audit, saveSettings } from '@/lib/db';

function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

export async function saveSettingsAction(form: FormData): Promise<void> {
  const session = await requireAdmin();

  const autoBreakRules: Array<{ overMinutes: number; breakMinutes: number }> = [];
  for (let i = 0; i < 3; i++) {
    const over = str(form, `autoBreakOver${i}`);
    const minutes = str(form, `autoBreakMinutes${i}`);
    if (over !== undefined && minutes !== undefined) {
      autoBreakRules.push({ overMinutes: Number(over), breakMinutes: Number(minutes) });
    }
  }

  const closing = str(form, 'payrollClosingDay');
  const input = {
    defaultHourlyWage: str(form, 'defaultHourlyWage'),
    weeklyHoursCap: str(form, 'weeklyHoursCap'),
    weekStartsOn: str(form, 'weekStartsOn'),
    roundingMinutes: str(form, 'roundingMinutes'),
    roundingMode: str(form, 'roundingMode'),
    autoBreakEnabled: str(form, 'autoBreakEnabled') === 'true',
    autoBreakRules,
    nightPremiumRate: str(form, 'nightPremiumRate'),
    nightStart: str(form, 'nightStart'),
    nightEnd: str(form, 'nightEnd'),
    payrollClosingDay: closing === 'EOM' || closing === undefined ? 'EOM' : Number(closing),
    yenRounding: str(form, 'yenRounding'),
    openShiftMode: str(form, 'openShiftMode'),
    earlyShiftEnd: str(form, 'earlyShiftEnd'),
    lateShiftStart: str(form, 'lateShiftStart'),
    newcomerMonths: str(form, 'newcomerMonths'),
    minorNightStart: str(form, 'minorNightStart'),
    preferenceReminderDaysBefore: (str(form, 'preferenceReminderDaysBefore') ?? '2,0')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    csvEncoding: str(form, 'csvEncoding'),
    openShiftExpireHours: str(form, 'openShiftExpireHours'),
  };

  try {
    const saved = await saveSettings(input, session.name);
    await audit(session, 'settings.update', 'AppSetting', 'shift_payroll.settings', saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    redirect(`/admin/settings?error=${encodeURIComponent(`保存できませんでした: ${message}`)}`);
  }
  revalidatePath('/admin/settings');
  redirect('/admin/settings?saved=1');
}
