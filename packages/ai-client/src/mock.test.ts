import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createAiClient, getAiEnv } from './env.js';
import { MockAiClient } from './mock.js';
import { AiClientError, extractText, lastUserText, silentAiLogger } from './types.js';

describe('MockAiClient', () => {
  it('responder の JSON をスキーマ検証して返す', async () => {
    const client = new MockAiClient({
      responder: { json: () => ({ answer: 'はい', confidence: 'high' }) },
    });
    const schema = z.object({ answer: z.string(), confidence: z.enum(['high', 'low', 'no_answer']) });
    const result = await client.generateJson({ messages: [{ role: 'user', content: 'q' }], schema, purpose: 'test' });
    expect(result.data).toEqual({ answer: 'はい', confidence: 'high' });
    expect(result.mode).toBe('mock');
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.purpose).toBe('test');
  });

  it('スキーマに合わない応答は AiClientError にする', async () => {
    const client = new MockAiClient({ responder: { json: () => ({ answer: 1 }) } });
    const schema = z.object({ answer: z.string() });
    await expect(client.generateJson({ messages: [{ role: 'user', content: 'q' }], schema })).rejects.toBeInstanceOf(
      AiClientError,
    );
  });

  it('json responder が無い場合は明示的なエラー', async () => {
    const client = new MockAiClient();
    await expect(
      client.generateJson({ messages: [{ role: 'user', content: 'q' }], schema: z.object({}) }),
    ).rejects.toThrow(/responder/);
  });

  it('text は responder 未指定でも固定文を返す', async () => {
    const client = new MockAiClient();
    const result = await client.generateText({ messages: [{ role: 'user', content: 'q' }] });
    expect(result.text).toContain('モック');
  });
});

describe('createAiClient / getAiEnv', () => {
  it('API キー未設定ならモック、モデル既定は claude-sonnet-4-6', () => {
    const env = getAiEnv({});
    expect(env.configured).toBe(false);
    expect(env.model).toBe('claude-sonnet-4-6');
    const client = createAiClient({ env: {}, logger: silentAiLogger });
    expect(client.mode).toBe('mock');
  });

  it('API キーがあれば live(実通信はしない)', () => {
    const client = createAiClient({
      env: { ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_MODEL: 'claude-sonnet-4-6' },
      logger: silentAiLogger,
    });
    expect(client.mode).toBe('live');
    expect(client.model).toBe('claude-sonnet-4-6');
  });
});

describe('helpers', () => {
  it('extractText / lastUserText', () => {
    expect(extractText('abc')).toBe('abc');
    expect(
      extractText([
        { type: 'text', text: 'a' },
        { type: 'image', mediaType: 'image/png', base64: '' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('a\nb');
    expect(
      lastUserText([
        { role: 'user', content: '1' },
        { role: 'assistant', content: '2' },
        { role: 'user', content: '3' },
      ]),
    ).toBe('3');
  });
});
