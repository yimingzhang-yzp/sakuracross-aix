/**
 * 実 DB での競合テスト。TEST_DATABASE_URL が設定されているときだけ実行する。
 *   例: TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres  (npm run db:local)
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

loadEnv({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('欠員募集の排他制御(実 DB)', () => {
  let prisma: import('@sakura-cross/shared-db').PrismaClientInstance;
  let repo: import('../lib/open-shift/apply').OpenShiftRepository;
  let applyToOpenShift: typeof import('../lib/open-shift/apply').applyToOpenShift;
  const staffIds: string[] = [];
  let openShiftId = '';
  let businessDayId = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const shared = await import('@sakura-cross/shared-db');
    prisma = shared.getPrisma();
    ({ applyToOpenShift } = await import('../lib/open-shift/apply'));
    const { createPrismaOpenShiftRepository } = await import('../lib/open-shift/prisma-repo');
    repo = createPrismaOpenShiftRepository(prisma);

    const day = await prisma.businessDay.upsert({
      where: { businessDate: new Date('2099-01-10T00:00:00Z') },
      update: {},
      create: { businessDate: new Date('2099-01-10T00:00:00Z'), eventType: 'NORMAL' },
    });
    businessDayId = day.id;
    for (let i = 0; i < 5; i++) {
      const s = await prisma.staff.create({
        data: { name: `競合テスト${i}`, role: 'BARTENDER', employmentType: 'PART_TIME', hourlyWage: 1000 },
      });
      staffIds.push(s.id);
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.openShiftRequest.deleteMany({ where: { businessDayId } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.businessDay.delete({ where: { id: businessDayId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('5 名が同時に応募しても FILLED は 1 名だけ', async () => {
    const os = await prisma.openShiftRequest.create({
      data: {
        businessDayId,
        roleNeeded: 'BARTENDER',
        start: new Date('2099-01-10T11:00:00Z'),
        end: new Date('2099-01-10T20:00:00Z'),
        reason: '競合テスト',
        mode: 'FIRST_COME',
      },
    });
    openShiftId = os.id;

    const results = await Promise.all(staffIds.map((id) => applyToOpenShift(repo, openShiftId, id)));
    expect(results.filter((r) => r === 'WON')).toHaveLength(1);
    expect(results.filter((r) => r === 'LOST')).toHaveLength(4);

    const after = await prisma.openShiftRequest.findUniqueOrThrow({ where: { id: openShiftId }, include: { applications: true } });
    expect(after.status).toBe('FILLED');
    expect(after.version).toBe(1);
    expect(after.applications.filter((a) => a.status === 'WON')).toHaveLength(1);
    expect(after.applications.filter((a) => a.status === 'LOST')).toHaveLength(4);
    expect(staffIds).toContain(after.filledByStaffId);
  });
});
