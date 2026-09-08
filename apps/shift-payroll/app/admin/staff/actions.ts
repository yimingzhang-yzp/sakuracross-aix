'use server';

import { businessDateToDbValue, toBusinessDate } from '@sakura-cross/business-date';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireAdmin } from '@/lib/auth/session';
import { audit, db, loadSettings } from '@/lib/db';
import { TAX_TABLE_TYPES, type TaxTableType } from '@/lib/payroll/deductions';
import { STAFF_ROLES } from '@/lib/scheduling/types';

const roleEnum = z.enum(STAFF_ROLES as [string, ...string[]]);
const employmentEnum = z.enum(['PART_TIME', 'FULL_TIME', 'CONTRACT']);
const taxTableEnum = z.enum(TAX_TABLE_TYPES as [TaxTableType, ...TaxTableType[]]);

function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** 法定控除に関する入力(スタッフ追加・編集で共通) */
const deductionFieldsSchema = z.object({
  taxTableType: taxTableEnum.default('KOU'),
  dependentsCount: z.coerce.number().int().min(0).default(0),
  standardMonthlyRemuneration: z.coerce.number().int().min(0).optional(),
  fixedIncomeTax: z.coerce.number().int().min(0).optional(),
});

function deductionFieldsFromForm(form: FormData) {
  const parsed = deductionFieldsSchema.safeParse({
    taxTableType: str(form, 'taxTableType'),
    dependentsCount: str(form, 'dependentsCount'),
    standardMonthlyRemuneration: str(form, 'standardMonthlyRemuneration'),
    fixedIncomeTax: str(form, 'fixedIncomeTax'),
  });
  if (!parsed.success) return null;
  return {
    taxTableType: parsed.data.taxTableType,
    dependentsCount: parsed.data.dependentsCount,
    standardMonthlyRemuneration: parsed.data.standardMonthlyRemuneration ?? null,
    fixedIncomeTax: parsed.data.fixedIncomeTax ?? null,
    socialInsuranceEnrolled: form.get('socialInsuranceEnrolled') === '1',
    careInsuranceApplicable: form.get('careInsuranceApplicable') === '1',
    employmentInsuranceEnrolled: form.get('employmentInsuranceEnrolled') === '1',
  };
}

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function skillsFromForm(form: FormData): Record<string, boolean> | undefined {
  const values = form.getAll('skills').filter((v): v is string => typeof v === 'string');
  if (values.length === 0) return undefined;
  return Object.fromEntries(values.map((v) => [v, true]));
}

export async function createStaffAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const settings = await loadSettings();
  const parsed = z
    .object({
      name: z.string().min(1),
      nameKana: z.string().optional(),
      role: roleEnum,
      employmentType: employmentEnum,
      hourlyWage: z.coerce.number().int().min(0).default(settings.defaultHourlyWage),
      monthlySalary: z.coerce.number().int().min(0).optional(),
      hiredAt: z.string().optional(),
      isMinor: z.boolean(),
    })
    .safeParse({
      name: str(form, 'name'),
      nameKana: str(form, 'nameKana'),
      role: str(form, 'role'),
      employmentType: str(form, 'employmentType'),
      hourlyWage: str(form, 'hourlyWage'),
      monthlySalary: str(form, 'monthlySalary'),
      hiredAt: str(form, 'hiredAt'),
      isMinor: form.get('isMinor') === '1',
    });
  if (!parsed.success) fail('/admin/staff', '入力内容を確認してください: ' + parsed.error.issues.map((i) => i.path.join('.')).join(', '));
  const deduction = deductionFieldsFromForm(form);
  if (!deduction) fail('/admin/staff', '法定控除の入力(扶養人数など)を確認してください');

  const data = parsed.data;
  const staff = await db().staff.create({
    data: {
      name: data.name,
      nameKana: data.nameKana ?? null,
      role: data.role as never,
      employmentType: data.employmentType,
      hourlyWage: data.hourlyWage,
      monthlySalary: data.monthlySalary ?? null,
      hiredAt: data.hiredAt ? new Date(`${data.hiredAt}T00:00:00Z`) : null,
      isMinor: data.isMinor,
      ...deduction,
      wageHistories:
        data.hourlyWage > 0
          ? { create: { hourlyWage: data.hourlyWage, effectiveFrom: businessDateToDbValue(data.hiredAt ?? toBusinessDate(new Date())) } }
          : undefined,
    },
  });
  await audit(session, 'staff.create', 'Staff', staff.id, { name: staff.name });
  revalidatePath('/admin/staff');
  redirect(`/admin/staff/${staff.id}?ok=${encodeURIComponent('スタッフを追加しました')}`);
}

export async function updateStaffAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const id = str(form, 'id');
  if (!id) fail('/admin/staff', 'ID がありません');
  const parsed = z
    .object({
      name: z.string().min(1),
      nameKana: z.string().optional(),
      role: roleEnum,
      employmentType: employmentEnum,
      monthlySalary: z.coerce.number().int().min(0).optional(),
      hiredAt: z.string().optional(),
      accessRole: z.enum(['ADMIN', 'STAFF']),
      authUserId: z.string().optional(),
    })
    .safeParse({
      name: str(form, 'name'),
      nameKana: str(form, 'nameKana'),
      role: str(form, 'role'),
      employmentType: str(form, 'employmentType'),
      monthlySalary: str(form, 'monthlySalary'),
      hiredAt: str(form, 'hiredAt'),
      accessRole: str(form, 'accessRole'),
      authUserId: str(form, 'authUserId'),
    });
  if (!parsed.success) fail(`/admin/staff/${id}`, '入力内容を確認してください');
  const deduction = deductionFieldsFromForm(form);
  if (!deduction) fail(`/admin/staff/${id}`, '法定控除の入力(扶養人数・標準報酬月額・固定税額)を確認してください');
  const d = parsed.data;
  await db().staff.update({
    where: { id },
    data: {
      name: d.name,
      nameKana: d.nameKana ?? null,
      role: d.role as never,
      employmentType: d.employmentType,
      monthlySalary: d.monthlySalary ?? null,
      hiredAt: d.hiredAt ? new Date(`${d.hiredAt}T00:00:00Z`) : null,
      accessRole: d.accessRole,
      authUserId: d.authUserId ?? null,
      isMinor: form.get('isMinor') === '1',
      isActive: form.get('isActive') === '1',
      skills: skillsFromForm(form) ?? {},
      ...deduction,
    },
  });
  await audit(session, 'staff.update', 'Staff', id, { name: d.name });
  revalidatePath('/admin/staff');
  redirect(`/admin/staff/${id}?ok=${encodeURIComponent('保存しました')}`);
}

export async function addWageHistoryAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const staffId = str(form, 'staffId');
  const hourlyWage = Number(str(form, 'hourlyWage'));
  const effectiveFrom = str(form, 'effectiveFrom');
  if (!staffId || !Number.isInteger(hourlyWage) || hourlyWage < 0 || !effectiveFrom) fail(`/admin/staff/${staffId ?? ''}`, '時給と適用開始日を入力してください');

  const prisma = db();
  await prisma.wageHistory.create({ data: { staffId, hourlyWage, effectiveFrom: businessDateToDbValue(effectiveFrom) } });
  // 現在値のキャッシュを更新(今日時点で有効な最新の履歴)
  const latest = await prisma.wageHistory.findFirst({
    where: { staffId, effectiveFrom: { lte: businessDateToDbValue(toBusinessDate(new Date())) } },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (latest) await prisma.staff.update({ where: { id: staffId }, data: { hourlyWage: latest.hourlyWage } });
  await audit(session, 'staff.wage_change', 'Staff', staffId, { hourlyWage, effectiveFrom });
  revalidatePath(`/admin/staff/${staffId}`);
  redirect(`/admin/staff/${staffId}?ok=${encodeURIComponent('時給改定を追加しました')}`);
}

export async function unlinkLineAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const staffId = str(form, 'staffId');
  if (!staffId) fail('/admin/staff', 'ID がありません');
  await db().staff.update({ where: { id: staffId }, data: { lineUserId: null } });
  await audit(session, 'staff.line_unlink', 'Staff', staffId);
  revalidatePath(`/admin/staff/${staffId}`);
  redirect(`/admin/staff/${staffId}?ok=${encodeURIComponent('LINE 連携を解除しました')}`);
}

export async function approveRegistrationAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const requestId = str(form, 'requestId');
  const existingStaffId = str(form, 'staffId');
  const role = str(form, 'role') ?? 'RECEPTION';
  if (!requestId) fail('/admin/staff', '申請 ID がありません');

  const prisma = db();
  const request = await prisma.lineRegistrationRequest.findUnique({ where: { id: requestId } });
  if (!request || request.status !== 'PENDING') fail('/admin/staff', '申請が見つからないか、既に処理済みです');

  const settings = await loadSettings();
  const staffId = await prisma.$transaction(async (tx) => {
    let id = existingStaffId;
    if (id) {
      await tx.staff.update({ where: { id }, data: { lineUserId: request.lineUserId } });
    } else {
      const created = await tx.staff.create({
        data: {
          name: request.nameInput,
          nameKana: request.nameKanaInput,
          role: role as never,
          employmentType: 'PART_TIME',
          hourlyWage: settings.defaultHourlyWage,
          hiredAt: new Date(),
          lineUserId: request.lineUserId,
          wageHistories: { create: { hourlyWage: settings.defaultHourlyWage, effectiveFrom: businessDateToDbValue(toBusinessDate(new Date())) } },
        },
      });
      id = created.id;
    }
    await tx.lineRegistrationRequest.update({
      where: { id: requestId },
      data: { status: 'APPROVED', staffId: id, resolvedBy: session.name, resolvedAt: new Date() },
    });
    return id;
  });

  await audit(session, 'registration.approve', 'LineRegistrationRequest', requestId, { staffId });
  // 本人へ通知(キュー経由)
  const { enqueueLinePush } = await import('@/lib/line/queue');
  await enqueueLinePush(request.lineUserId, [
    { type: 'text', text: '登録が承認されました。リッチメニューから「希望提出」「シフト確認」「打刻」「給与明細」が使えます。' },
  ]);
  revalidatePath('/admin/staff');
  redirect(`/admin/staff?ok=${encodeURIComponent('登録を承認しました')}`);
}

export async function rejectRegistrationAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const requestId = str(form, 'requestId');
  if (!requestId) fail('/admin/staff', '申請 ID がありません');
  await db().lineRegistrationRequest.update({
    where: { id: requestId },
    data: { status: 'REJECTED', resolvedBy: session.name, resolvedAt: new Date() },
  });
  await audit(session, 'registration.reject', 'LineRegistrationRequest', requestId);
  revalidatePath('/admin/staff');
  redirect(`/admin/staff?ok=${encodeURIComponent('申請を却下しました')}`);
}
