import { NextResponse } from 'next/server';

import { getAiBossEnv } from '@/lib/env';
import { processLinePushJobs } from '@/lib/escalation/deliver';
import { getStaffLineClient } from '@/lib/line/client';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/cron/jobs — 失敗キュー(LINE_PUSH)の再試行。Vercel Cron から 10 分ごとに呼ぶ(vercel.json)。
 * 認証: `Authorization: Bearer <CRON_SECRET>`(Vercel が自動付与)。CRON_SECRET 未設定時は開発環境のみ許可。
 */
export async function GET(request: Request): Promise<NextResponse> {
  const env = getAiBossEnv();
  const header = request.headers.get('authorization');
  if (env.cronSecret) {
    if (header !== `Bearer ${env.cronSecret}`) {
      return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
    }
  } else if (env.isProduction) {
    return NextResponse.json({ ok: false, message: 'CRON_SECRET が未設定です' }, { status: 500 });
  }

  const store = await getStore();
  const result = await processLinePushJobs({ store, messaging: getStaffLineClient(), logger: console });
  return NextResponse.json({
    ok: true,
    ...result,
    failed: result.failed.map((j) => ({ id: j.id, kind: j.kind, attempts: j.attempts, lastError: j.lastError })),
  });
}
