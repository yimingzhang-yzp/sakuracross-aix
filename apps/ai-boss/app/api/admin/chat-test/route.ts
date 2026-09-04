import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAdminSession } from '@/lib/admin/auth';
import { handleStaffQuestion } from '@/lib/chat/answer';
import { getChatRuntime } from '@/lib/chat/runtime';
import { loadSettings } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z.object({
  text: z.string().trim().min(1).max(2000),
  /** true なら現在の会話を閉じてから質問する(新しい会話として扱う) */
  reset: z.boolean().optional(),
});

/**
 * POST /api/admin/chat-test — 管理者が LINE を通さずに Bot の応答を試す。
 * 管理者ごとに「チャットテスト用スタッフ」(lineUserId = test:<管理者ID>)を作り、
 * 実際の LINE と同じ経路(handleStaffQuestion)で処理する。会話ログにも同じように記録される。
 */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await getAdminSession();
  if (session.status !== 'ok') {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '質問を入力してください(2000 文字以内)' }, { status: 400 });
  }

  const { store, ai, retriever } = await getChatRuntime();
  const lineUserId = `test:${session.admin.id}`;
  const staff =
    (await store.findStaffByLineUserId(lineUserId)) ??
    (await store.createProvisionalStaff({ lineUserId, displayName: `チャットテスト(${session.admin.name})` }));

  const now = new Date();
  if (parsed.data.reset) {
    const latest = await store.findLatestConversation(staff.id);
    if (latest && !latest.closedAt) await store.closeConversation(latest.id, now);
  }

  const settings = await loadSettings(store);
  const outcome = await handleStaffQuestion(
    { store, ai, retriever, settings, logger: console, now: () => now },
    { staff, text: parsed.data.text },
  );

  return NextResponse.json({
    reply: outcome.replyText,
    kind: outcome.kind,
    confidence: outcome.confidence,
    citedDocTitles: outcome.citedDocTitles,
    ticketId: outcome.ticketId,
    conversationId: outcome.conversationId,
    isNewConversation: outcome.isNewConversation,
    latencyMs: outcome.latencyMs,
    retrieved: outcome.retrieved.slice(0, 5).map((c) => ({ docTitle: c.docTitle, heading: c.heading, score: Math.round(c.score * 100) / 100 })),
    mode: ai.mode,
  });
}
