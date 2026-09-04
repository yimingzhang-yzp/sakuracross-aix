import { NextResponse } from 'next/server';

import { isCronAuthorized, sendHealthReport } from '@/lib/cron';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const text = await sendHealthReport();
  return NextResponse.json({ ok: true, text });
}

export const POST = GET;
