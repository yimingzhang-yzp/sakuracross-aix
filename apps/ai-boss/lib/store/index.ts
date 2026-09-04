/**
 * ストアの選択とシングルトン管理。
 *
 * - DATABASE_URL あり → PrismaStore(Supabase)
 * - なし             → InMemoryStore(プロセス内)。初回に knowledge_seed/ を自動投入して、
 *                       実 DB なしでも LINE 応答・管理画面が一通り触れるようにする
 */
import { getPrisma, isDatabaseConfigured } from '@sakura-cross/shared-db';

import { seedKnowledge } from '../knowledge/seed-loader';
import { type AiBossSettings, SETTINGS_KEY, resolveSettings } from '../settings';
import { InMemoryStore } from './memory';
import { PrismaStore } from './prisma';
import type { AiBossStore } from './types';

type GlobalWithStore = typeof globalThis & {
  __aiBossStore?: Promise<AiBossStore>;
};

const globalRef = globalThis as GlobalWithStore;

async function createStore(): Promise<AiBossStore> {
  if (isDatabaseConfigured()) {
    return new PrismaStore(getPrisma());
  }
  const store = new InMemoryStore();
  if (process.env.AI_BOSS_SKIP_AUTO_SEED !== '1') {
    try {
      const result = await seedKnowledge(store);
      console.info(
        `[ai-boss] DATABASE_URL 未設定のためメモリストアを使用します(knowledge_seed から ${result.created.length} 件を投入)。再起動でデータは消えます。`,
      );
    } catch (error) {
      console.warn('[ai-boss] knowledge_seed の自動投入に失敗しました', error instanceof Error ? error.message : error);
    }
  }
  return store;
}

export function getStore(): Promise<AiBossStore> {
  if (!globalRef.__aiBossStore) {
    globalRef.__aiBossStore = createStore();
  }
  return globalRef.__aiBossStore;
}

/** テスト用: シングルトンを差し替える */
export function setStoreForTesting(store: AiBossStore | undefined): void {
  globalRef.__aiBossStore = store ? Promise.resolve(store) : undefined;
}

export async function loadSettings(store: AiBossStore): Promise<AiBossSettings> {
  return resolveSettings(await store.getSetting(SETTINGS_KEY));
}

export async function saveSettings(store: AiBossStore, settings: AiBossSettings, updatedBy: string | null): Promise<void> {
  await store.setSetting(SETTINGS_KEY, settings, updatedBy);
}

export type { AiBossStore } from './types';
export { InMemoryStore } from './memory';
export { PrismaStore } from './prisma';
