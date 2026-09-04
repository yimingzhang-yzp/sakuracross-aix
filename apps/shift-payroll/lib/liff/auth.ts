/**
 * LIFF からの API 呼び出しの認証
 *
 * - 本番: `Authorization: Bearer <LIFF の ID トークン>` を LINE の verify エンドポイントで検証し lineUserId(sub)を得る
 * - 開発: LINE_STAFF_LIFF_CHANNEL_ID 未設定 かつ 非本番のとき、`x-dev-line-user-id` ヘッダで任意のユーザーになれる
 */
import { getPrisma } from '@sakura-cross/shared-db';

export interface LiffIdentity {
  lineUserId: string;
  displayName: string | null;
  dev: boolean;
}

const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';

export function isLiffDevMode(): boolean {
  return !process.env.LINE_STAFF_LIFF_CHANNEL_ID?.trim() && process.env.NODE_ENV !== 'production';
}

export async function identifyLiffRequest(request: Request, fetchImpl: typeof fetch = fetch): Promise<LiffIdentity | null> {
  const auth = request.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;

  if (token) {
    const channelId = process.env.LINE_STAFF_LIFF_CHANNEL_ID?.trim();
    if (!channelId) return null;
    const body = new URLSearchParams({ id_token: token, client_id: channelId });
    const res = await fetchImpl(VERIFY_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) return null;
    const json = (await res.json()) as { sub?: string; name?: string };
    if (!json.sub) return null;
    return { lineUserId: json.sub, displayName: json.name ?? null, dev: false };
  }

  if (isLiffDevMode()) {
    const devUser = request.headers.get('x-dev-line-user-id')?.trim();
    if (devUser) return { lineUserId: devUser, displayName: request.headers.get('x-dev-display-name') ?? 'テストユーザー', dev: true };
  }
  return null;
}

export async function resolveStaff(identity: LiffIdentity) {
  return getPrisma().staff.findUnique({ where: { lineUserId: identity.lineUserId } });
}

export function unauthorized(message = 'LINE の認証情報がありません'): Response {
  return Response.json({ error: message }, { status: 401 });
}

export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}
