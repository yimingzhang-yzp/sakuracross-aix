'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireAdmin } from '@/lib/auth/session';
import { audit, db } from '@/lib/db';
import { expandTemplates } from '@/lib/scheduling/templates';
import { STAFF_ROLES, type StaffRole } from '@/lib/scheduling/types';

const schema = z.object({
  eventType: z.enum(['NORMAL', 'WEEKEND', 'BIG_EVENT', 'RENTAL', 'CLOSED']),
  roleNeeded: z.enum(STAFF_ROLES as [string, ...string[]]),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  headcount: z.coerce.number().int().min(1),
});

export async function addTemplateRowAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const parsed = schema.safeParse({
    eventType: form.get('eventType'),
    roleNeeded: form.get('roleNeeded'),
    startTime: form.get('startTime'),
    endTime: form.get('endTime'),
    headcount: form.get('headcount'),
  });
  if (!parsed.success) redirect(`/admin/templates?error=${encodeURIComponent('入力内容を確認してください(時刻は HH:mm)')}`);
  const d = parsed.data;
  try {
    // 時刻の整合性チェック(終了が開始以前なら例外)
    expandTemplates('2025-01-01', [{ roleNeeded: d.roleNeeded as StaffRole, startTime: d.startTime, endTime: d.endTime, headcount: d.headcount }]);
  } catch (e) {
    redirect(`/admin/templates?error=${encodeURIComponent((e as Error).message)}`);
  }
  const prisma = db();
  const max = await prisma.staffingTemplate.aggregate({ _max: { sortOrder: true } });
  const row = await prisma.staffingTemplate.create({
    data: { ...d, roleNeeded: d.roleNeeded as never, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  await audit(session, 'template.add', 'StaffingTemplate', row.id, d);
  revalidatePath('/admin/templates');
  redirect('/admin/templates');
}

export async function deleteTemplateRowAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const id = form.get('id');
  if (typeof id !== 'string') redirect('/admin/templates');
  await db().staffingTemplate.delete({ where: { id } });
  await audit(session, 'template.delete', 'StaffingTemplate', id);
  revalidatePath('/admin/templates');
  redirect('/admin/templates');
}
