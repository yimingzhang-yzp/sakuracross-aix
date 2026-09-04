import { getPrisma } from '@sakura-cross/shared-db';

import { identifyLiffRequest, resolveStaff, unauthorized } from '@/lib/liff/auth';
import { STAFF_ROLE_LABELS, type StaffRole } from '@/lib/scheduling/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const identity = await identifyLiffRequest(request);
  if (!identity) return unauthorized();
  const staff = await resolveStaff(identity);
  if (staff) {
    return Response.json({
      registered: true,
      lineUserId: identity.lineUserId,
      staff: { id: staff.id, name: staff.name, role: staff.role, roleLabel: STAFF_ROLE_LABELS[staff.role as StaffRole], isActive: staff.isActive },
    });
  }
  const pending = await getPrisma().lineRegistrationRequest.findUnique({ where: { lineUserId: identity.lineUserId } });
  return Response.json({ registered: false, lineUserId: identity.lineUserId, pendingRegistration: pending ? { status: pending.status, nameInput: pending.nameInput } : null });
}
