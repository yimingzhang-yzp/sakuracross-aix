import { describe, expect, it, vi } from 'vitest';

import { LineApiError, MockLineMessagingClient, createLineMessagingClient, textMessage } from './messaging.js';
import { silentLogger } from './types.js';

describe('createLineMessagingClient: フォールバック', () => {
  it('アクセストークン未設定ならモックを返し、警告を出す', async () => {
    const warn = vi.fn();
    const client = createLineMessagingClient({ logger: { ...silentLogger, warn } });
    expect(client.mode).toBe('mock');
    expect(client).toBeInstanceOf(MockLineMessagingClient);
    expect(warn).toHaveBeenCalled();
    await expect(client.replyMessage('token', textMessage('hi'))).resolves.toBeUndefined();
  });

  it('空白のみのトークンも未設定扱い', () => {
    expect(createLineMessagingClient({ channelAccessToken: '  ', logger: silentLogger }).mode).toBe('mock');
  });

  it('トークンがあれば live クライアント', () => {
    const client = createLineMessagingClient({ channelAccessToken: 'tok', fetchImpl: vi.fn(), logger: silentLogger });
    expect(client.mode).toBe('live');
  });
});

describe('MockLineMessagingClient', () => {
  it('送信内容を記録する', async () => {
    const client = new MockLineMessagingClient(silentLogger);
    await client.replyMessage('reply-1', textMessage('返信'));
    await client.pushMessage('U1', [textMessage('a'), textMessage('b')]);
    await client.showLoadingAnimation('U1');
    expect(client.sent.map((s) => s.kind)).toEqual(['reply', 'push', 'loading']);
    expect(client.sent[1]).toMatchObject({ target: 'U1', messages: [{ text: 'a' }, { text: 'b' }] });
    client.clear();
    expect(client.sent).toHaveLength(0);
  });

  it('メッセージ 0 件・6 件以上は RangeError', async () => {
    const client = new MockLineMessagingClient(silentLogger);
    await expect(client.replyMessage('t', [])).rejects.toThrow(RangeError);
    await expect(client.pushMessage('U', Array.from({ length: 6 }, () => textMessage('x')))).rejects.toThrow(
      RangeError,
    );
  });
});

describe('live クライアント(fetch をモック)', () => {
  function createFetch(status = 200, body = '{}') {
    return vi.fn(async () => new Response(body, { status }));
  }

  it('reply は /v2/bot/message/reply に Bearer 付きで POST', async () => {
    const fetchImpl = createFetch();
    const client = createLineMessagingClient({ channelAccessToken: 'tok', fetchImpl, logger: silentLogger });
    await client.replyMessage('reply-1', textMessage('こんにちは'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.line.me/v2/bot/message/reply');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({
      replyToken: 'reply-1',
      messages: [{ type: 'text', text: 'こんにちは' }],
    });
  });

  it('push は /v2/bot/message/push', async () => {
    const fetchImpl = createFetch();
    const client = createLineMessagingClient({ channelAccessToken: 'tok', fetchImpl, logger: silentLogger });
    await client.pushMessage('U1', textMessage('x'));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect(JSON.parse(init.body as string).to).toBe('U1');
  });

  it('ローディング秒数は 5〜60 の 5 秒単位に丸める', async () => {
    const fetchImpl = createFetch();
    const client = createLineMessagingClient({ channelAccessToken: 'tok', fetchImpl, logger: silentLogger });
    await client.showLoadingAnimation('U1', 3);
    await client.showLoadingAnimation('U1', 23);
    await client.showLoadingAnimation('U1', 100);
    const seconds = fetchImpl.mock.calls.map(
      (call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string).loadingSeconds,
    );
    expect(seconds).toEqual([5, 25, 60]);
  });

  it('apiBaseUrl を差し替えられる(末尾スラッシュ許容)', async () => {
    const fetchImpl = createFetch();
    const client = createLineMessagingClient({
      channelAccessToken: 'tok',
      fetchImpl,
      apiBaseUrl: 'http://localhost:9999/',
      logger: silentLogger,
    });
    await client.pushMessage('U1', textMessage('x'));
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('http://localhost:9999/v2/bot/message/push');
  });

  it('非 2xx は LineApiError', async () => {
    const fetchImpl = createFetch(400, '{"message":"Invalid reply token"}');
    const client = createLineMessagingClient({ channelAccessToken: 'tok', fetchImpl, logger: silentLogger });
    const error = await client.replyMessage('expired', textMessage('x')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LineApiError);
    expect((error as LineApiError).status).toBe(400);
    expect((error as LineApiError).endpoint).toBe('/v2/bot/message/reply');
    expect((error as LineApiError).message).toContain('Invalid reply token');
  });
});
