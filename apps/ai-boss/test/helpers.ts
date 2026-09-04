import path from 'node:path';

import { MockAiClient } from '@sakura-cross/ai-client';

import { aiBossMockResponder } from '../lib/ai/mock-responder';
import { KeywordRetriever } from '../lib/knowledge/retriever';
import { seedKnowledge } from '../lib/knowledge/seed-loader';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { InMemoryStore } from '../lib/store/memory';

export const SEED_DIR = path.resolve(__dirname, '../knowledge_seed');

export async function createSeededStore(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await seedKnowledge(store, { seedDir: SEED_DIR, updatedBy: 'test' });
  return store;
}

export function createTestDeps(store: InMemoryStore) {
  const ai = new MockAiClient({ responder: aiBossMockResponder });
  const retriever = new KeywordRetriever(store, { revisionCheckIntervalMs: 0 });
  return { store, ai, retriever, settings: DEFAULT_SETTINGS };
}
