import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryWebhookEventStore,
  type PrismaLikeClient,
  createPrismaWebhookEventStore,
} from './idempotency.js';

const meta = { eventType: 'message' };

describe('InMemoryWebhookEventStore', () => {
  it('初回は予約でき、同じ ID の 2 回目は拒否される', async () => {
    const store = new InMemoryWebhookEventStore();
    expect(await store.tryClaim('evt-1', meta)).toBe(true);
    expect(await store.tryClaim('evt-1', meta)).toBe(false);
    expect(await store.tryClaim('evt-2', meta)).toBe(true);
    expect(store.size).toBe(2);
  });

  it('release すると再度予約できる', async () => {
    const store = new InMemoryWebhookEventStore();
    await store.tryClaim('evt-1', meta);
    await store.release('evt-1');
    expect(await store.tryClaim('evt-1', meta)).toBe(true);
  });

  it('存在しない ID の release はエラーにならない', async () => {
    const store = new InMemoryWebhookEventStore();
    await expect(store.release('nope')).resolves.toBeUndefined();
  });

  it('TTL を超えた予約は破棄される', async () => {
    let now = 1_000_000;
    const store = new InMemoryWebhookEventStore({ ttlMs: 1000, now: () => now });
    expect(await store.tryClaim('evt-1', meta)).toBe(true);
    now += 999;
    expect(await store.tryClaim('evt-1', meta)).toBe(false);
    now += 2;
    expect(await store.tryClaim('evt-1', meta)).toBe(true);
  });

  it('maxSize を超えると古いものから削除される', async () => {
    const store = new InMemoryWebhookEventStore({ maxSize: 2 });
    await store.tryClaim('a', meta);
    await store.tryClaim('b', meta);
    await store.tryClaim('c', meta);
    expect(store.size).toBe(2);
    expect(await store.tryClaim('a', meta)).toBe(true); // a は追い出されている
  });

  it('clear で全消去', async () => {
    const store = new InMemoryWebhookEventStore();
    await store.tryClaim('a', meta);
    store.clear();
    expect(store.size).toBe(0);
  });
});

function createFakePrisma(): PrismaLikeClient & { rows: Map<string, Record<string, unknown>> } {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    processedWebhookEvent: {
      async create({ data }) {
        if (rows.has(data.webhookEventId)) {
          const error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          throw error;
        }
        rows.set(data.webhookEventId, data);
        return data;
      },
      async deleteMany({ where }) {
        const existed = rows.delete(where.webhookEventId);
        return { count: existed ? 1 : 0 };
      },
    },
  };
}

describe('createPrismaWebhookEventStore', () => {
  it('INSERT 成功で true、一意制約違反(P2002)で false', async () => {
    const prisma = createFakePrisma();
    const store = createPrismaWebhookEventStore(prisma, { defaultChannel: 'STAFF' });
    expect(await store.tryClaim('evt-1', meta)).toBe(true);
    expect(await store.tryClaim('evt-1', meta)).toBe(false);
    expect(prisma.rows.get('evt-1')).toMatchObject({ channel: 'STAFF', eventType: 'message' });
  });

  it('meta.channel があれば既定チャネルより優先', async () => {
    const prisma = createFakePrisma();
    const store = createPrismaWebhookEventStore(prisma, { defaultChannel: 'STAFF' });
    await store.tryClaim('evt-1', { eventType: 'postback', channel: 'ADMIN' });
    expect(prisma.rows.get('evt-1')).toMatchObject({ channel: 'ADMIN' });
  });

  it('P2002 以外のエラーはそのまま投げる(DB 障害を握りつぶさない)', async () => {
    const prisma = createFakePrisma();
    prisma.processedWebhookEvent.create = vi.fn().mockRejectedValue(new Error('connection refused'));
    const store = createPrismaWebhookEventStore(prisma, { defaultChannel: 'STAFF' });
    await expect(store.tryClaim('evt-1', meta)).rejects.toThrow('connection refused');
  });

  it('createMany があればそれを優先し、count=0(ON CONFLICT DO NOTHING)で重複判定する', async () => {
    const prisma = createFakePrisma();
    const seen = new Set<string>();
    const createMany = vi.fn(async ({ data, skipDuplicates }: { data: { webhookEventId: string }[]; skipDuplicates: boolean }) => {
      expect(skipDuplicates).toBe(true);
      let count = 0;
      for (const row of data) {
        if (!seen.has(row.webhookEventId)) {
          seen.add(row.webhookEventId);
          count += 1;
        }
      }
      return { count };
    });
    prisma.processedWebhookEvent.createMany = createMany;
    prisma.processedWebhookEvent.create = vi.fn().mockRejectedValue(new Error('create は呼ばれないはず'));
    const store = createPrismaWebhookEventStore(prisma, { defaultChannel: 'STAFF' });
    expect(await store.tryClaim('evt-1', meta)).toBe(true);
    expect(await store.tryClaim('evt-1', meta)).toBe(false);
    expect(createMany).toHaveBeenCalledTimes(2);
  });

  it('release は deleteMany を呼び、再予約できるようになる', async () => {
    const prisma = createFakePrisma();
    const store = createPrismaWebhookEventStore(prisma, { defaultChannel: 'STAFF' });
    await store.tryClaim('evt-1', meta);
    await store.release('evt-1');
    expect(prisma.rows.has('evt-1')).toBe(false);
    expect(await store.tryClaim('evt-1', meta)).toBe(true);
  });
});
