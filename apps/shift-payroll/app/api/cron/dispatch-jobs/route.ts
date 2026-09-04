import { NextResponse } from 'next/server';

import { dispatchPendingJobs, expireOpenShifts, isCronAuthorized } from '@/lib/cron';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const [jobs, expired] = await Promise.all([dispatchPendingJobs(100), expireOpenShifts()]);
  return NextResponse.json({ ok: true, jobs, expiredOpenShifts: expired });
}

export const POST = GET;
