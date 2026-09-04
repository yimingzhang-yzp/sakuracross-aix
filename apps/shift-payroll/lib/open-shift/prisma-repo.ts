/**
 * OpenShiftRepository の Prisma 実装。
 * tryFill は `updateMany` の WHERE に status=OPEN と version を含めることで原子的に確定する。
 */
import type { PrismaClientInstance } from '@sakura-cross/shared-db';

import type { OpenShiftRepository, OpenShiftSnapshot } from './apply';

export function createPrismaOpenShiftRepository(prisma: PrismaClientInstance): OpenShiftRepository {
  return {
    async get(openShiftId): Promise<OpenShiftSnapshot | null> {
      const row = await prisma.openShiftRequest.findUnique({ where: { id: openShiftId } });
      if (!row) return null;
      return {
        id: row.id,
        status: row.status,
        version: row.version,
        mode: row.mode === 'MANAGER_APPROVAL' ? 'MANAGER_APPROVAL' : 'FIRST_COME',
        filledByStaffId: row.filledByStaffId,
        expiresAt: row.expiresAt,
      };
    },
    async recordApplication(openShiftId, staffId): Promise<boolean> {
      try {
        await prisma.openShiftApplication.create({ data: { openShiftRequestId: openShiftId, staffId, status: 'APPLIED' } });
        return true;
      } catch (error) {
        if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') return false;
        throw error;
      }
    },
    async tryFill(openShiftId, staffId, expectedVersion): Promise<boolean> {
      const result = await prisma.openShiftRequest.updateMany({
        where: { id: openShiftId, status: 'OPEN', version: expectedVersion },
        data: { status: 'FILLED', filledByStaffId: staffId, version: { increment: 1 } },
      });
      return result.count === 1;
    },
    async setApplicationStatus(openShiftId, staffId, status): Promise<void> {
      await prisma.openShiftApplication.updateMany({ where: { openShiftRequestId: openShiftId, staffId }, data: { status } });
    },
  };
}
