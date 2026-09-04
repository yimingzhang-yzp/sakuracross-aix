import {
  InMemoryWebhookEventStore,
  MockLineMessagingClient,
  computeLineSignature,
  createLineWebhookHandler,
  silentLogger,
} from '@sakura-cross/line-router';
import { describe, expect, it } from 'vitest';

import { createAiLineEventHandler, createShiftForwarder } from '../lib/line/handler';
import { DEFAULT_SETTINGS, LOGGING_NOTICE } from '../lib/settings';
import { createSeededStore, createTestDeps } from './helpers';

const SECRET = 'test-secret';

function body(events: unknown[]): string {
  return JSON.stringify({ destination: 'Ubot', events });
}

function textEvent(id: string, userId: string, text: string) {
  return {
    type: 'message',
    webhookEventId: id,
    timestamp: Date.now(),
    mode: 'active',
    source: { type: 'user', userId },
    replyToken: `reply-${id}`,
    message: { id: `m-${id}`, type: 'text', text },
  };
}

async function setup() {
  const store = await createSeededStore();
  const deps = createTestDeps(store);
  const messaging = new MockLineMessagingClient(silentLogger);
  const forwarded: unknown[] = [];
  const handler = createLineWebhookHandler({
    channelSecret: SECRET,
    channel: 'STAFF',
    eventStore: new InMemoryWebhookEventStore(),
    logger: silentLogger,
    handlers: {
      ai: createAiLineEventHandler({
        ...deps,
        messaging,
        loadSettings: async () => DEFAULT_SETTINGS,
        logger: silentLogger,
        fetchDisplayName: async () => 'テスト太郎',
      }),
      shift: createShiftForwarder({
        url: 'http://shift.local',
        secret: 's',
        logger: silentLogger,
        fetchImpl: async (_url, init) => {
          forwarded.push(JSON.parse(String(init?.body)));
          return new Response('{}', { status: 200 });
        },
      }),
    },
  });
  const send = (raw: string) => handler({ rawBody: raw, signature: computeLineSignature(raw, SECRET) });
  return { store, deps, messaging, handler, send, forwarded };
}

describe('LINE Webhook(ai-boss)', () => {
  it('署名が不正なら 401', async () => {
    const { handler } = await setup();
    const result = await handler({ rawBody: body([]), signature: 'bad' });
    expect(result.status).toBe(401);
  });

  it('follow で仮スタッフを作成し、記録告知を含むあいさつを reply する(shift へも転送)', async () => {
    const { store, messaging, send, forwarded } = await setup();
    const raw = body([
      { type: 'follow', webhookEventId: 'f1', timestamp: Date.now(), mode: 'active', source: { type: 'user', userId: 'Unew' }, replyToken: 'r1' },
    ]);
    const result = await send(raw);
    expect(result.status).toBe(200);
    expect(result.body.processed).toBe(1);
    const staff = await store.findStaffByLineUserId('Unew');
    expect(staff?.name).toBe('テスト太郎');
    expect(staff?.isActive).toBe(false);
    const reply = messaging.sent.find((s) => s.kind === 'reply');
    expect(String(reply?.messages[0]?.text)).toContain(LOGGING_NOTICE);
    expect(forwarded).toHaveLength(1);
  });

  it('テキスト質問に replyToken で回答し、ローディング表示を呼ぶ', async () => {
    const { messaging, send } = await setup();
    const result = await send(body([textEvent('e1', 'U1', 'ドリンクチケットは翌日も使えますか?')]));
    expect(result.status).toBe(200);
    expect(messaging.sent.some((s) => s.kind === 'loading' && s.target === 'U1')).toBe(true);
    const reply = messaging.sent.find((s) => s.kind === 'reply' && s.target === 'reply-e1');
    expect(String(reply?.messages[0]?.text)).toContain('根拠');
    expect(messaging.sent.filter((s) => s.kind === 'push')).toHaveLength(0);
  });

  it('同じ webhookEventId の再送はスキップされる', async () => {
    const { messaging, send } = await setup();
    const raw = body([textEvent('dup', 'U1', 'ハイボールのレシピは?')]);
    await send(raw);
    const second = await send(raw);
    expect(second.body.duplicates).toBe(1);
    expect(messaging.sent.filter((s) => s.kind === 'reply')).toHaveLength(1);
  });

  it('スタンプ・画像には定型文を返す', async () => {
    const { messaging, send } = await setup();
    await send(
      body([
        {
          type: 'message',
          webhookEventId: 's1',
          timestamp: Date.now(),
          mode: 'active',
          source: { type: 'user', userId: 'U2' },
          replyToken: 'reply-s1',
          message: { id: 'm', type: 'sticker', packageId: '1', stickerId: '2' },
        },
      ]),
    );
    const reply = messaging.sent.find((s) => s.kind === 'reply');
    expect(String(reply?.messages[0]?.text)).toBe(DEFAULT_SETTINGS.nonTextReply);
  });

  it('shift: postback は ai 側では処理せず shift-payroll へ転送する', async () => {
    const { messaging, send, forwarded } = await setup();
    await send(
      body([
        {
          type: 'postback',
          webhookEventId: 'p1',
          timestamp: Date.now(),
          mode: 'active',
          source: { type: 'user', userId: 'U3' },
          replyToken: 'reply-p1',
          postback: { data: 'shift:apply_open_shift?id=1' },
        },
      ]),
    );
    expect(forwarded).toHaveLength(1);
    expect(messaging.sent).toHaveLength(0);
  });
});
