/**
 * LINE Webhook 署名検証
 *
 * LINE は リクエストボディ(生のバイト列)を チャネルシークレットで HMAC-SHA256 し、
 * Base64 エンコードした値を `x-line-signature` ヘッダで送る。
 * 検証はタイミング攻撃対策として定数時間比較で行う。
 *
 * 注意: Next.js の Route Handler では `await req.text()` で「パース前の生ボディ」を取得して渡すこと。
 * JSON.parse → JSON.stringify した文字列では署名が一致しない。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const LINE_SIGNATURE_HEADER = 'x-line-signature' as const;

/**
 * 署名を計算する(テストやモック送信で使用)。
 */
export function computeLineSignature(rawBody: string | Uint8Array, channelSecret: string): string {
  if (!channelSecret) {
    throw new Error('channelSecret が空です');
  }
  return createHmac('sha256', channelSecret).update(rawBody).digest('base64');
}

/**
 * 署名を検証する。ヘッダ欠落・不一致・長さ違いはすべて false。例外は投げない。
 */
export function verifyLineSignature(
  rawBody: string | Uint8Array,
  signature: string | null | undefined,
  channelSecret: string,
): boolean {
  if (!signature || !channelSecret) {
    return false;
  }
  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(computeLineSignature(rawBody, channelSecret), 'base64');
    actual = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  if (expected.length === 0 || expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}
