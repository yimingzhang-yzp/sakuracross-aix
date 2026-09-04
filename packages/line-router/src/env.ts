/**
 * LINE 公式アカウント 2 系統(スタッフ / 管理)の環境変数を解決する。
 *
 *   LINE_STAFF_CHANNEL_SECRET / LINE_STAFF_CHANNEL_ACCESS_TOKEN  … ①「CROSS スタッフ」
 *   LINE_ADMIN_CHANNEL_SECRET / LINE_ADMIN_CHANNEL_ACCESS_TOKEN  … ②「CROSS 管理」
 */

export type LineChannelKind = 'staff' | 'admin';

export interface LineChannelEnv {
  kind: LineChannelKind;
  channelSecret: string | undefined;
  channelAccessToken: string | undefined;
  /** シークレットとトークンの両方が設定されているか */
  configured: boolean;
}

export const LINE_ENV_KEYS: Readonly<Record<LineChannelKind, { secret: string; accessToken: string }>> = {
  staff: { secret: 'LINE_STAFF_CHANNEL_SECRET', accessToken: 'LINE_STAFF_CHANNEL_ACCESS_TOKEN' },
  admin: { secret: 'LINE_ADMIN_CHANNEL_SECRET', accessToken: 'LINE_ADMIN_CHANNEL_ACCESS_TOKEN' },
};

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getLineChannelEnv(
  kind: LineChannelKind,
  env: Record<string, string | undefined> = process.env,
): LineChannelEnv {
  const keys = LINE_ENV_KEYS[kind];
  const channelSecret = nonEmpty(env[keys.secret]);
  const channelAccessToken = nonEmpty(env[keys.accessToken]);
  return {
    kind,
    channelSecret,
    channelAccessToken,
    configured: Boolean(channelSecret && channelAccessToken),
  };
}
