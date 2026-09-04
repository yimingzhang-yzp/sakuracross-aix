import { describe, expect, it, vi } from 'vitest';

import { type LineEventHandler, createLineWebhookHandler } from './handler.js';
import { InMemoryWebhookEventStore } from './idempotency.js';
import { computeLineSignature } from './signature.js';
import { postbackEvent, simpleEvent, textEvent, webhookBody } from './test-utils.js';
import { type LineWebhookEvent, silentLogger } from './types.js';

const secret = 'channel-secret';

function signed(rawBody: string, channelSecret = secret) {
  return { rawBody, signature: computeLineSignature(rawBody, channelSecret) };
}

function setup(overrides: Partial<Parameters<typeof createLineWebhookHandler>[0]> = {}) {
  const shift = vi.fn<LineEventHandler>();
  const ai = vi.fn<LineEventHandler>();
  const onIgnored = vi.fn();
  const eventStore = new InMemoryWebhookEventStore();
  const handle = createLineWebhookHandler({
    channelSecret: secret,
    eventStore,
    handlers: { shift, ai },
    onIgnored,
    logger: silentLogger,
    channel: 'STAFF',
    nodeEnv: 'test',
    ...overrides,
  });
  return { handle, shift, ai, onIgnored, eventStore };
}

describe('createLineWebhookHandler: 署名検証', () => {
  it('正しい署名なら 200 で処理される', async () => {
    const { handle, ai } = setup();
    const result = await handle(signed(webhookBody([textEvent('hi')])));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, received: 1, processed: 1, duplicates: 0, failed: [] });
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it('署名が不正なら 401 で、ハンドラもストアも触らない', async () => {
    const { handle, ai, shift, eventStore } = setup();
    const body = webhookBody([textEvent('hi')]);
    const result = await handle({ rawBody: body, signature: computeLineSignature(body, 'wrong') });
    expect(result.status).toBe(401);
    expect(ai).not.toHaveBeenCalled();
    expect(shift).not.toHaveBeenCalled();
    expect(eventStore.size).toBe(0);
  });

  it('署名ヘッダ欠落は 401', async () => {
    const { handle } = setup();
    const result = await handle({ rawBody: webhookBody([]), signature: null });
    expect(result.status).toBe(401);
  });

  it('LINE コンソールの「検証」ボタン(events: [])は 200', async () => {
    const { handle } = setup();
    const result = await handle(signed(webhookBody([])));
    expect(result.status).toBe(200);
    expect(result.body.received).toBe(0);
  });

  it('JSON として壊れた本文は 400', async () => {
    const { handle } = setup();
    const result = await handle(signed('{not json'));
    expect(result.status).toBe(400);
  });

  it('events が配列でない本文は 400', async () => {
    const { handle } = setup();
    const result = await handle(signed(JSON.stringify({ destination: 'U', events: 'x' })));
    expect(result.status).toBe(400);
  });

  it('Uint8Array の生ボディでも検証・解析できる', async () => {
    const { handle, ai } = setup();
    const bytes = Buffer.from(webhookBody([textEvent('bytes')]), 'utf8');
    const result = await handle({ rawBody: bytes, signature: computeLineSignature(bytes, secret) });
    expect(result.status).toBe(200);
    expect(ai).toHaveBeenCalledTimes(1);
  });
});

describe('createLineWebhookHandler: シークレット未設定時の挙動', () => {
  it('非本番で未設定なら警告を出して署名なしを受け付ける(モック動作)', async () => {
    const warn = vi.fn();
    const { handle, ai } = setup({
      channelSecret: undefined,
      nodeEnv: 'development',
      logger: { ...silentLogger, warn },
    });
    const result = await handle({ rawBody: webhookBody([textEvent('dev')]), signature: null });
    expect(result.status).toBe(200);
    expect(ai).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it('本番で未設定なら生成時に例外', () => {
    expect(() =>
      createLineWebhookHandler({
        channelSecret: undefined,
        nodeEnv: 'production',
        eventStore: new InMemoryWebhookEventStore(),
        handlers: {},
        logger: silentLogger,
      }),
    ).toThrow(/チャネルシークレット/);
  });

  it('空白のみのシークレットは未設定扱い', () => {
    expect(() =>
      createLineWebhookHandler({
        channelSecret: '   ',
        nodeEnv: 'production',
        eventStore: new InMemoryWebhookEventStore(),
        handlers: {},
        logger: silentLogger,
      }),
    ).toThrow();
  });
});

describe('createLineWebhookHandler: 冪等性', () => {
  it('同じ webhookEventId は 2 回目以降スキップされる', async () => {
    const { handle, ai } = setup();
    const event = textEvent('once');
    const body = webhookBody([event]);
    await handle(signed(body));
    const second = await handle(signed(body));
    expect(second.body).toMatchObject({ received: 1, processed: 0, duplicates: 1 });
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it('LINE の再送(isRedelivery=true)も同 ID ならスキップ', async () => {
    const { handle, ai } = setup();
    const event = textEvent('once');
    await handle(signed(webhookBody([event])));
    const redelivered: LineWebhookEvent = { ...event, deliveryContext: { isRedelivery: true } };
    const result = await handle(signed(webhookBody([redelivered])));
    expect(result.body.duplicates).toBe(1);
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it('1 リクエスト内に同じ ID が 2 つあっても 1 回だけ処理', async () => {
    const { handle, ai } = setup();
    const event = textEvent('dup');
    const result = await handle(signed(webhookBody([event, { ...event }])));
    expect(result.body).toMatchObject({ received: 2, processed: 1, duplicates: 1 });
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it('ストアにはチャネルとイベント種別が渡る', async () => {
    const tryClaim = vi.fn().mockResolvedValue(true);
    const { handle } = setup({ eventStore: { tryClaim, release: vi.fn() } });
    await handle(signed(webhookBody([postbackEvent('shift:x')])));
    expect(tryClaim).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ eventType: 'postback', channel: 'STAFF' }),
    );
  });

  it('webhookEventId が無いイベントは冪等性チェックなしで処理される', async () => {
    const { handle, ai, eventStore } = setup();
    const event = textEvent('no-id');
    delete (event as Partial<LineWebhookEvent>).webhookEventId;
    const result = await handle(signed(webhookBody([event])));
    expect(result.body.processed).toBe(1);
    expect(ai).toHaveBeenCalledTimes(1);
    expect(eventStore.size).toBe(0);
  });
});

describe('createLineWebhookHandler: 振分け', () => {
  it('shift: Postback はシフトハンドラのみ', async () => {
    const { handle, shift, ai } = setup();
    await handle(signed(webhookBody([postbackEvent('shift:apply?id=1')])));
    expect(shift).toHaveBeenCalledTimes(1);
    expect(ai).not.toHaveBeenCalled();
    const [, context] = shift.mock.calls[0]!;
    expect(context.namespace).toBe('shift');
    expect(context.destination).toBe('Ubot');
    expect(context.route.postback).toMatchObject({ action: 'apply', params: { id: '1' } });
  });

  it('ai: Postback とテキストは AI ハンドラのみ', async () => {
    const { handle, shift, ai } = setup();
    await handle(signed(webhookBody([postbackEvent('ai:quiz?idx=1'), textEvent('質問')])));
    expect(ai).toHaveBeenCalledTimes(2);
    expect(shift).not.toHaveBeenCalled();
  });

  it('follow は両ハンドラに届き、processed は 1 とカウント', async () => {
    const { handle, shift, ai } = setup();
    const result = await handle(signed(webhookBody([simpleEvent('follow')])));
    expect(shift).toHaveBeenCalledTimes(1);
    expect(ai).toHaveBeenCalledTimes(1);
    expect(shift.mock.calls[0]![1].namespace).toBe('shift');
    expect(ai.mock.calls[0]![1].namespace).toBe('ai');
    expect(result.body.processed).toBe(1);
  });

  it('振分け先が無いイベントは onIgnored に渡り ignored にカウント', async () => {
    const { handle, onIgnored } = setup();
    const result = await handle(signed(webhookBody([simpleEvent('beacon'), postbackEvent('unknown:x')])));
    expect(result.body.ignored).toBe(2);
    expect(onIgnored).toHaveBeenCalledTimes(2);
  });

  it('ハンドラが登録されていない名前空間は ignored 扱い', async () => {
    const ai = vi.fn<LineEventHandler>();
    const onIgnored = vi.fn();
    const handle = createLineWebhookHandler({
      channelSecret: secret,
      eventStore: new InMemoryWebhookEventStore(),
      handlers: { ai },
      onIgnored,
      logger: silentLogger,
      nodeEnv: 'test',
    });
    const result = await handle(signed(webhookBody([postbackEvent('shift:apply')])));
    expect(result.body.ignored).toBe(1);
    expect(onIgnored).toHaveBeenCalledTimes(1);
    expect(ai).not.toHaveBeenCalled();
  });
});

describe('createLineWebhookHandler: ハンドラ失敗時', () => {
  it('失敗したイベントは failed に載り 500 を返し、予約が解除されて再送で再処理できる', async () => {
    const { handle, ai, eventStore } = setup();
    ai.mockRejectedValueOnce(new Error('AI API down'));
    const event = textEvent('retry me');
    const body = webhookBody([event]);

    const first = await handle(signed(body));
    expect(first.status).toBe(500);
    expect(first.body.ok).toBe(false);
    expect(first.body.failed).toEqual([
      { webhookEventId: event.webhookEventId, eventType: 'message', error: 'AI API down' },
    ]);
    expect(eventStore.size).toBe(0);

    const second = await handle(signed(body));
    expect(second.status).toBe(200);
    expect(second.body.processed).toBe(1);
    expect(ai).toHaveBeenCalledTimes(2);
  });

  it('1 件失敗しても他のイベントは処理され、成功分は予約が残る', async () => {
    const { handle, ai, shift, eventStore } = setup();
    ai.mockRejectedValueOnce(new Error('boom'));
    const failing = textEvent('fail');
    const ok = postbackEvent('shift:ok');
    const result = await handle(signed(webhookBody([failing, ok])));
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ received: 2, processed: 1 });
    expect(shift).toHaveBeenCalledTimes(1);
    expect(eventStore.size).toBe(1);
    // 再送: 成功済みの ok はスキップ、failing のみ再処理
    const retry = await handle(signed(webhookBody([failing, ok])));
    expect(retry.body).toMatchObject({ processed: 1, duplicates: 1 });
    expect(shift).toHaveBeenCalledTimes(1);
  });

  it('release 自体が失敗してもクラッシュしない', async () => {
    const release = vi.fn().mockRejectedValue(new Error('db down'));
    const { handle, ai } = setup({ eventStore: { tryClaim: vi.fn().mockResolvedValue(true), release } });
    ai.mockRejectedValueOnce(new Error('boom'));
    const result = await handle(signed(webhookBody([textEvent('x')])));
    expect(result.status).toBe(500);
    expect(release).toHaveBeenCalled();
  });
});
