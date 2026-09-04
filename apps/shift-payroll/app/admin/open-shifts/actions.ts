'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/auth/session';
import { approveOpenShiftApplication, closeOpenShift } from '@/lib/open-shift/service';

export async function approveApplicationAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const id = form.get('id');
  const staffId = form.get('staffId');
  if (typeof id !== 'string' || typeof staffId !== 'string') redirect('/admin/open-shifts');
  const ok = await approveOpenShiftApplication(id, staffId, session.name);
  revalidatePath('/admin/open-shifts');
  redirect(`/admin/open-shifts?${ok ? `ok=${encodeURIComponent('確定して本人と他の応募者へ通知しました')}` : `error=${encodeURIComponent('確定できませんでした(既に確定済みか終了しています)')}`}`);
}

export async function closeOpenShiftAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const id = form.get('id');
  if (typeof id !== 'string') redirect('/admin/open-shifts');
  await closeOpenShift(id, session.name);
  revalidatePath('/admin/open-shifts');
  redirect(`/admin/open-shifts?ok=${encodeURIComponent('募集を締め切り、配信先へ通知しました')}`);
}
