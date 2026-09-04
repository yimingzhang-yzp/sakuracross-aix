import { NextResponse } from 'next/server';

import { isCronAuthorized, sendPreferenceReminders } from '@/lib/cron';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await sendPreferenceReminders();
  return NextResponse.json({ ok: true, ...result });
}

export const POST = GET;
