import { type LineMessagingClient, createLineMessagingClient, getLineChannelEnv } from '@sakura-cross/line-router';

type GlobalWithLine = typeof globalThis & { __aiBossLineClient?: LineMessagingClient };
const globalRef = globalThis as GlobalWithLine;

/** 「CROSS スタッフ」アカウントの送信クライアント(トークン未設定ならモック) */
export function getStaffLineClient(): LineMessagingClient {
  if (!globalRef.__aiBossLineClient) {
    const env = getLineChannelEnv('staff');
    globalRef.__aiBossLineClient = createLineMessagingClient({ channelAccessToken: env.channelAccessToken });
  }
  return globalRef.__aiBossLineClient;
}

export function setStaffLineClientForTesting(client: LineMessagingClient | undefined): void {
  globalRef.__aiBossLineClient = client;
}

/**
 * LINE プロフィール取得(表示名)。トークン未設定・失敗時は null(仮スタッフ名にフォールバック)。
 */
export async function fetchLineDisplayName(
  userId: string,
  options: { channelAccessToken?: string; fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  const token = options.channelAccessToken ?? getLineChannelEnv('staff').channelAccessToken;
  if (!token) return null;
  try {
    const response = await (options.fetchImpl ?? fetch)(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { displayName?: unknown };
    return typeof json.displayName === 'string' ? json.displayName : null;
  } catch {
    return null;
  }
}
