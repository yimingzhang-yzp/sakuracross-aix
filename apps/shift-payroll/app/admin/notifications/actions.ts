'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/auth/session';
import { audit } from '@/lib/db';
import { dispatchPendingJobs, retryJob } from '@/lib/line/queue';

export async function retryJobAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const id = form.get('id');
  if (typeof id !== 'string') redirect('/admin/notifications');
  await retryJob(id);
  await audit(session, 'job.retry', 'Job', id);
  const result = await dispatchPendingJobs(10);
  revalidatePath('/admin/notifications');
  redirect(`/admin/notifications?ok=${encodeURIComponent(`再試行しました(成功 ${result.succeeded} / 失敗 ${result.failed})`)}`);
}

export async function dispatchNowAction(): Promise<void> {
  await requireAdmin();
  const result = await dispatchPendingJobs(100);
  revalidatePath('/admin/notifications');
  redirect(`/admin/notifications?ok=${encodeURIComponent(`${result.processed} 件処理(成功 ${result.succeeded} / 失敗 ${result.failed})`)}`);
}
