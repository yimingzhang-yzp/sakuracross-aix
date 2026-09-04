/**
 * 「CROSS スタッフ」公式アカウントの Webhook
 *
 * - 署名検証・冪等性・振分けは @sakura-cross/line-router
 * - shift: Postback(欠員募集への応募)と follow(登録案内)をここで処理
 * - ai: 宛て(フリーテキスト・画像)は ai-boss の内部 API へ転送(AI_BOSS_INTERNAL_URL 未設定ならログのみ)
 */
import {
  type LineEventHandler,
  type LineWebhookHandler,
  createLineWebhookHandler,
  createPrismaWebhookEventStore,
  getLineChannelEnv,
  isPostbackEvent,
  isTextMessageEvent,
} from '@sakura-cross/line-router';
import { getPrisma } from '@sakura-cross/shared-db';
import { NextResponse } from 'next/server';

import { registrationGuideMessage } from '@/lib/line/messages';
import { lineClient } from '@/lib/line/queue';
import { handleOpenShiftApplication } from '@/lib/open-shift/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const handleShift: LineEventHandler = async (event, context) => {
  const client = lineClient('staff');
  if (isPostbackEvent(event) && context.route.postback?.action === 'apply_open_shift') {
    const id = context.route.postback.params.id;
    const userId = event.source?.userId;
    if (!id || !userId) return;
    const result = await handleOpenShiftApplication(id, userId);
    await client.replyMessage(event.replyToken, [{ type: 'text', text: result.replyText }]);
    return;
  }
  if (event.type === 'follow' && event.replyToken) {
    const userId = event.source?.userId;
    const staff = userId ? await getPrisma().staff.findUnique({ where: { lineUserId: userId } }) : null;
    await client.replyMessage(event.replyToken, [
      staff ? { type: 'text', text: `${staff.name}さん、おかえりなさい。リッチメニューから各機能をご利用ください。` } : registrationGuideMessage(),
    ]);
    return;
  }
  if (event.type === 'unfollow' && event.source?.userId) {
    // ブロックされた場合は連携を残しつつログのみ(再追加時に復帰できる)
    console.info('[webhook] unfollow', event.source.userId);
  }
};

const forwardToAiBoss: LineEventHandler = async (event, context) => {
  const url = process.env.AI_BOSS_INTERNAL_URL?.trim();
  const secret = process.env.INTERNAL_API_SECRET?.trim();
  if (!url) {
    if (isTextMessageEvent(event)) console.info('[webhook] AI上司への転送先が未設定のためスキップ:', event.message.text.slice(0, 40));
    return;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-internal-secret': secret } : {}) },
    body: JSON.stringify({ destination: context.destination, event }),
  });
  if (!res.ok) throw new Error(`ai-boss への転送に失敗: HTTP ${res.status}`);
};

let handler: LineWebhookHandler | null = null;
function getHandler(): LineWebhookHandler {
  if (!handler) {
    handler = createLineWebhookHandler({
      channelSecret: getLineChannelEnv('staff').channelSecret,
      eventStore: createPrismaWebhookEventStore(getPrisma(), { defaultChannel: 'STAFF' }),
      channel: 'STAFF',
      handlers: { shift: handleShift, ai: forwardToAiBoss },
    });
  }
  return handler;
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const result = await getHandler()({ rawBody, signature: request.headers.get('x-line-signature') });
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(): Promise<Response> {
  return NextResponse.json({ ok: true, endpoint: 'LINE webhook (CROSS スタッフ)', configured: getLineChannelEnv('staff').configured });
}
