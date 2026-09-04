'use server';

import { dbValueToBusinessDate, isBusinessDateString } from '@sakura-cross/business-date';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { createPayrollDraft, finalizePayrollRun } from '@/lib/payroll/service';

function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

export async function createDraftAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const start = str(form, 'start');
  const end = str(form, 'end');
  if (!start || !end || !isBusinessDateString(start) || !isBusinessDateString(end) || start > end) {
    redirect(`/admin/payroll?error=${encodeURIComponent('期間を確認してください')}`);
  }
  const existing = await db().payrollRun.findFirst({ where: { status: 'FINALIZED', periodStart: { lte: new Date(`${end}T00:00:00Z`) }, periodEnd: { gte: new Date(`${start}T00:00:00Z`) } } });
  if (existing) {
    redirect(`/admin/payroll?error=${encodeURIComponent('確定済みの期間と重なっています。確定分の画面から「再計算」してください')}`);
  }
  const { runId, result } = await createPayrollDraft({ start, end }, session.name);
  revalidatePath('/admin/payroll');
  redirect(`/admin/payroll/${runId}?ok=${encodeURIComponent(`${result.items.length} 名分のドラフトを作成しました`)}`);
}

export async function recalcAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const id = str(form, 'id');
  if (!id) redirect('/admin/payroll');
  const run = await db().payrollRun.findUnique({ where: { id } });
  if (!run) redirect('/admin/payroll');
  const period = { start: dbValueToBusinessDate(run.periodStart), end: dbValueToBusinessDate(run.periodEnd) };
  const { runId } = await createPayrollDraft(period, session.name);
  revalidatePath('/admin/payroll');
  redirect(`/admin/payroll/${runId}?ok=${encodeURIComponent('最新の勤怠で再計算しました(新しいドラフト)')}`);
}

export async function finalizeAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const id = str(form, 'id');
  if (!id) redirect('/admin/payroll');
  const { notified } = await finalizePayrollRun(id, session.name);
  revalidatePath('/admin/payroll');
  revalidatePath('/admin/attendance');
  redirect(`/admin/payroll/${id}?ok=${encodeURIComponent(`確定しました。明細を ${notified} 名に LINE 配信しました`)}`);
}
