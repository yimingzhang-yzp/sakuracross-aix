import { type LineMessagingClient, MockLineMessagingClient, silentLogger } from '@sakura-cross/line-router';
import { describe, expect, it } from 'vitest';

import { JOB_KIND_LINE_PUSH, deliverManagerAnswer, nextRetryDelayMs, processLinePushJobs } from '../lib/escalation/deliver';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { InMemoryStore } from '../lib/store/memory';

class FailingClient implements LineMessagingClient {
  readonly mode = 'live' as const;
  pushes = 0;
  constructor(private readonly failTimes: number) {}
  async replyMessage(): Promise<void> {}
  async pushMessage(): Promise<void> {
    this.pushes += 1;
    if (this.pushes <= this.failTimes) throw new Error('LINE API 500');
  }
  async showLoadingAnimation(): Promise<void> {}
}

async function ticketFixture(store: InMemoryStore) {
  const staff = store.addStaff({ name: '新人', lineUserId: 'Ustaff' });
  const ticket = await store.createEscalation({ staffId: staff.id, conversationId: null, question: 'Wi-Fi は?' });
  await store.updateEscalation(ticket.id, { status: 'ANSWERED', managerAnswer: 'cross-guest です', answeredBy: '店長', answeredAt: new Date() });
  return ticket;
}

describe('deliverManagerAnswer', () => {
  it('店長回答をテンプレートで整形してプッシュし、deliveredAt を記録する', async () => {
    const store = new InMemoryStore();
    const ticket = await ticketFixture(store);
    const messaging = new MockLineMessagingClient(silentLogger);
    const result = await deliverManagerAnswer({ store, messaging, settings: DEFAULT_SETTINGS }, ticket.id);
    expect(result.delivered).toBe(true);
    const push = messaging.sent.find((s) => s.kind === 'push');
    expect(push?.target).toBe('Ustaff');
    expect(String(push?.messages[0]?.text)).toContain('cross-guest です');
    expect(String(push?.messages[0]?.text)).toContain('Wi-Fi は?');
    expect((await store.getEscalation(ticket.id))?.deliveredAt).not.toBeNull();
  });

  it('プッシュ失敗時は Job キューに登録する', async () => {
    const store = new InMemoryStore();
    const ticket = await ticketFixture(store);
    const result = await deliverManagerAnswer({ store, messaging: new FailingClient(99), settings: DEFAULT_SETTINGS }, ticket.id);
    expect(result.delivered).toBe(false);
    expect(result.queuedJobId).not.toBeNull();
    const jobs = await store.listJobs({ status: 'PENDING' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.kind).toBe(JOB_KIND_LINE_PUSH);
  });

  it('LINE が紐付いていないスタッフには配信できない旨を返す', async () => {
    const store = new InMemoryStore();
    const staff = store.addStaff({ name: '未連携' });
    const ticket = await store.createEscalation({ staffId: staff.id, conversationId: null, question: 'q' });
    await store.updateEscalation(ticket.id, { managerAnswer: 'a' });
    const result = await deliverManagerAnswer({ store, messaging: new MockLineMessagingClient(silentLogger), settings: DEFAULT_SETTINGS }, ticket.id);
    expect(result.delivered).toBe(false);
    expect(result.reason).toContain('LINE');
  });
});

describe('processLinePushJobs', () => {
  it('失敗を指数バックオフで再試行し、3 回失敗で FAILED にする', async () => {
    expect(nextRetryDelayMs(1)).toBe(5 * 60 * 1000);
    expect(nextRetryDelayMs(2)).toBe(30 * 60 * 1000);
    expect(nextRetryDelayMs(3)).toBeNull();

    const store = new InMemoryStore();
    const start = new Date('2026-09-03T10:00:00Z');
    await store.enqueueJob(JOB_KIND_LINE_PUSH, { to: 'U', text: 'hello' }, start);
    const client = new FailingClient(99);

    let now = start;
    const r1 = await processLinePushJobs({ store, messaging: client, now: () => now });
    expect(r1.retried).toBe(1);
    // まだ実行時刻前なので掴まない
    now = new Date(start.getTime() + 60 * 1000);
    expect((await processLinePushJobs({ store, messaging: client, now: () => now })).processed).toBe(0);
    now = new Date(start.getTime() + 6 * 60 * 1000);
    expect((await processLinePushJobs({ store, messaging: client, now: () => now })).retried).toBe(1);
    now = new Date(now.getTime() + 31 * 60 * 1000);
    const r3 = await processLinePushJobs({ store, messaging: client, now: () => now });
    expect(r3.failed).toHaveLength(1);
    expect((await store.listJobs({ status: 'FAILED' }))[0]?.attempts).toBe(3);
  });

  it('成功したら DONE にし、チケットの deliveredAt を埋める', async () => {
    const store = new InMemoryStore();
    const ticket = await ticketFixture(store);
    await store.enqueueJob(JOB_KIND_LINE_PUSH, { to: 'Ustaff', text: 'x', ticketId: ticket.id });
    const result = await processLinePushJobs({ store, messaging: new MockLineMessagingClient(silentLogger) });
    expect(result.succeeded).toBe(1);
    expect((await store.listJobs({ status: 'DONE' }))).toHaveLength(1);
    expect((await store.getEscalation(ticket.id))?.deliveredAt).not.toBeNull();
  });
});
