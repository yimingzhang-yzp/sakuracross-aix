import { addBusinessDays, businessDateToDbValue, dbValueToBusinessDate, toBusinessDate } from '@sakura-cross/business-date';
import { getPrisma } from '@sakura-cross/shared-db';

import { identifyLiffRequest, resolveStaff, unauthorized } from '@/lib/liff/auth';
import { STAFF_ROLE_LABELS, type StaffRole } from '@/lib/scheduling/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const identity = await identifyLiffRequest(request);
  if (!identity) return unauthorized();
  const staff = await resolveStaff(identity);
  if (!staff) return Response.json({ error: 'unregistered' }, { status: 403 });

  const today = toBusinessDate(new Date());
  const rows = await getPrisma().shiftAssignment.findMany({
    where: {
      staffId: staff.id,
      status: { in: ['CONFIRMED', 'ABSENT'] },
      businessDay: { businessDate: { gte: businessDateToDbValue(addBusinessDays(today, -7)), lte: businessDateToDbValue(addBusinessDays(today, 45)) } },
    },
    include: { businessDay: true },
    orderBy: { plannedStart: 'asc' },
  });
  return Response.json({
    today,
    assignments: rows.map((a) => ({
      id: a.id,
      businessDate: dbValueToBusinessDate(a.businessDay.businessDate),
      eventName: a.businessDay.eventName,
      role: a.roleAssigned,
      roleLabel: STAFF_ROLE_LABELS[a.roleAssigned as StaffRole],
      start: a.plannedStart.toISOString(),
      end: a.plannedEnd.toISOString(),
      status: a.status,
    })),
  });
}
