import { type AiClient, createAiClient } from '@sakura-cross/ai-client';

import { aiBossMockResponder } from './mock-responder';

type GlobalWithAi = typeof globalThis & { __aiBossAiClient?: AiClient };
const globalRef = globalThis as GlobalWithAi;

/** アプリ全体で 1 つの AI クライアント(キー未設定ならモック) */
export function getAiClient(): AiClient {
  if (!globalRef.__aiBossAiClient) {
    globalRef.__aiBossAiClient = createAiClient({ mockResponder: aiBossMockResponder });
  }
  return globalRef.__aiBossAiClient;
}

export function setAiClientForTesting(client: AiClient | undefined): void {
  globalRef.__aiBossAiClient = client;
}
