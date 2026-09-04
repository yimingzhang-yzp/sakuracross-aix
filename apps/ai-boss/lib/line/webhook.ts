/**
 * Webhook ハンドラの組み立て(Next.js 非依存)。
 * ai-boss が「CROSS スタッフ」アカウントの Webhook URL を直接受ける(ASSUMPTIONS.md Q1 の決定)。
 */
import { getPrisma, isDatabaseConfigured } from '@sakura-cross/shared-db';
import {
  InMemoryWebhookEventStore,
  type LineWebhookHandler,
  type PrismaLikeClient,
  type WebhookEventStore,
  createLineWebhookHandler,
  createPrismaWebhookEventStore,
  getLineChannelEnv,
} from '@sakura-cross/line-router';

import { getStaffLineClient } from './client';
import { createAiLineEventHandler, createShiftForwarder } from './handler';
import { getAiClient } from '../ai/client';
import { getAiBossEnv } from '../env';
import { createRetriever } from '../knowledge/retriever';
import { getStore, loadSettings } from '../store/index';

type GlobalWithWebhook = typeof globalThis & {
  __aiBossWebhook?: Promise<LineWebhookHandler>;
  __aiBossEventStore?: WebhookEventStore;
};
const globalRef = globalThis as GlobalWithWebhook;

function getEventStore(): WebhookEventStore {
  if (!globalRef.__aiBossEventStore) {
    globalRef.__aiBossEventStore = isDatabaseConfigured()
      // line-router は Prisma に依存しない duck typing(channel: string)。enum LineChannel との差はキャストで吸収する
      ? createPrismaWebhookEventStore(getPrisma() as unknown as PrismaLikeClient, { defaultChannel: 'STAFF' })
      : new InMemoryWebhookEventStore();
  }
  return globalRef.__aiBossEventStore;
}

async function buildWebhookHandler(): Promise<LineWebhookHandler> {
  const store = await getStore();
  const ai = getAiClient();
  const env = getAiBossEnv();
  const lineEnv = getLineChannelEnv('staff');
  return createLineWebhookHandler({
    channelSecret: lineEnv.channelSecret,
    channel: 'STAFF',
    eventStore: getEventStore(),
    handlers: {
      ai: createAiLineEventHandler({
        store,
        ai,
        retriever: createRetriever(store, ai),
        messaging: getStaffLineClient(),
        loadSettings: () => loadSettings(store),
      }),
      shift: createShiftForwarder({ url: env.shiftPayrollInternalUrl, secret: env.internalApiSecret }),
    },
  });
}

export function getWebhookHandler(): Promise<LineWebhookHandler> {
  if (!globalRef.__aiBossWebhook) {
    globalRef.__aiBossWebhook = buildWebhookHandler();
  }
  return globalRef.__aiBossWebhook;
}

export function resetWebhookHandlerForTesting(): void {
  globalRef.__aiBossWebhook = undefined;
  globalRef.__aiBossEventStore = undefined;
}
