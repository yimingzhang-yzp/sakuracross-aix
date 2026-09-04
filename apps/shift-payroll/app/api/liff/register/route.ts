import { getPrisma } from '@sakura-cross/shared-db';
import { z } from 'zod';

import { badRequest, identifyLiffRequest, resolveStaff, unauthorized } from '@/lib/liff/auth';
import { notifyAdmins } from '@/lib/line/queue';

export const dynamic = 'force-dynamic';

const schema = z.object({ name: z.string().trim().min(1).max(50), nameKana: z.string().trim().max(50).optional() });

export async function POST(request: Request): Promise<Response> {
  const identity = await identifyLiffRequest(request);
  if (!identity) return unauthorized();
  if (await resolveStaff(identity)) return badRequest('既に登録が完了しています');
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest('氏名を入力してください');

  const prisma = getPrisma();
  const req = await prisma.lineRegistrationRequest.upsert({
    where: { lineUserId: identity.lineUserId },
    update: { nameInput: parsed.data.name, nameKanaInput: parsed.data.nameKana ?? null, displayName: identity.displayName, status: 'PENDING', resolvedAt: null, resolvedBy: null },
    create: { lineUserId: identity.lineUserId, nameInput: parsed.data.name, nameKanaInput: parsed.data.nameKana ?? null, displayName: identity.displayName },
  });
  await notifyAdmins(`👤 LINE 登録申請: ${parsed.data.name} さん。管理画面 > スタッフ で承認してください。`, 'REGISTRATION');
  return Response.json({ ok: true, status: req.status });
}
