import { BUSINESS_TIMEZONE, toBusinessDate } from '@sakura-cross/business-date';
import { pingDatabase } from '@sakura-cross/shared-db';
import { NextResponse } from 'next/server';

// ビルド時に静的化させず、毎リクエスト評価する
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_NAME = 'invoice';

/**
 * GET /api/health
 *
 * - DB 未設定(DATABASE_URL なし)でも 200 を返す(db.status = "skipped")
 * - DB 設定済みで疎通できなければ 503(db.status = "error")
 * 毎朝 10:00 の死活監視レポート(共通前提)はこのエンドポイントを土台にする。
 */
export async function GET(): Promise<NextResponse> {
  const now = new Date();
  const db = await pingDatabase();
  const healthy = db.status !== 'error';

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      app: APP_NAME,
      timestamp: now.toISOString(),
      businessDate: toBusinessDate(now),
      timezone: BUSINESS_TIMEZONE,
      db,
      uptimeSeconds: Math.round(process.uptime()),
    },
    { status: healthy ? 200 : 503 },
  );
}
