import { LINE_SIGNATURE_HEADER } from '@sakura-cross/line-router';
import { NextResponse } from 'next/server';

import { getWebhookHandler } from '@/lib/line/webhook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// 回答生成(検索 + Claude)に数秒〜十数秒かかるため、Vercel の既定(10 秒)より長く取る
export const maxDuration = 60;

/**
 * POST /api/line/webhook — 「CROSS スタッフ」公式アカウントの Webhook。
 *
 * - 署名検証 → 冪等性(webhookEventId)→ 振分け(ai: / shift:)は @sakura-cross/line-router
 * - 失敗したイベントがあれば 500 を返し、LINE の再送(コンソールで「エラーの再送」ON)に任せる
 */
export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const handler = await getWebhookHandler();
  const result = await handler({ rawBody, signature: request.headers.get(LINE_SIGNATURE_HEADER) });
  return NextResponse.json(result.body, { status: result.status });
}

/** LINE Developers コンソールの「検証」ボタンは GET ではなく POST(空イベント)だが、疎通確認用に GET も 200 を返す */
export function GET(): NextResponse {
  return NextResponse.json({ ok: true, app: 'ai-boss', endpoint: 'line-webhook' });
}
