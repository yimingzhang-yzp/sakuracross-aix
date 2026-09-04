/**
 * 質問応答に必要な依存(ストア・AI・検索)をまとめて返す。
 * Webhook と管理画面のチャットテストで同じインスタンスを共有し、検索インデックスのキャッシュを再利用する。
 */
import type { AiClient } from '@sakura-cross/ai-client';

import { getAiClient } from '../ai/client';
import { type KnowledgeRetriever, createRetriever } from '../knowledge/retriever';
import { getStore } from '../store';
import type { AiBossStore } from '../store/types';

export interface ChatRuntime {
  store: AiBossStore;
  ai: AiClient;
  retriever: KnowledgeRetriever;
}

type GlobalWithRuntime = typeof globalThis & { __aiBossChatRuntime?: Promise<ChatRuntime> };
const globalRef = globalThis as GlobalWithRuntime;

export function getChatRuntime(): Promise<ChatRuntime> {
  if (!globalRef.__aiBossChatRuntime) {
    globalRef.__aiBossChatRuntime = (async () => {
      const store = await getStore();
      const ai = getAiClient();
      return { store, ai, retriever: createRetriever(store, ai) };
    })();
  }
  return globalRef.__aiBossChatRuntime;
}
