import { describe, expect, it } from 'vitest';

import { InMemoryOpenShiftRepository, type OpenShiftSnapshot, applyToOpenShift } from '../lib/open-shift/apply';

function repoWith(partial: Partial<OpenShiftSnapshot> = {}) {
  const row: OpenShiftSnapshot = {
    id: 'os-1',
    status: 'OPEN',
    version: 0,
    mode: 'FIRST_COME',
    filledByStaffId: null,
    expiresAt: null,
    ...partial,
  };
  return new InMemoryOpenShiftRepository(new Map([[row.id, row]]));
}

describe('受け入れ基準: 2 ユーザーが同時応募しても確定は必ず 1 名', () => {
  it('同時に 2 名が応募 → WON は 1 名、もう 1 名は LOST', async () => {
    const repo = repoWith();
    const results = await Promise.all([applyToOpenShift(repo, 'os-1', 'staff-a'), applyToOpenShift(repo, 'os-1', 'staff-b')]);
    expect(results.filter((r) => r === 'WON')).toHaveLength(1);
    expect(results.filter((r) => r === 'LOST')).toHaveLength(1);
    const statuses = repo.applications.get('os-1')!.map((a) => a.status).sort();
    expect(statuses).toEqual(['LOST', 'WON']);
  });

  it('10 名が同時応募しても勝者は 1 名(100 回繰り返し)', async () => {
    for (let round = 0; round < 100; round++) {
      const repo = repoWith();
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => applyToOpenShift(repo, 'os-1', `staff-${i}`)));
      expect(results.filter((r) => r === 'WON')).toHaveLength(1);
      expect(results.filter((r) => r === 'LOST')).toHaveLength(9);
    }
  });

  it('確定後に応募すると CLOSED(勝者本人は WON のまま)', async () => {
    const repo = repoWith();
    expect(await applyToOpenShift(repo, 'os-1', 'staff-a')).toBe('WON');
    expect(await applyToOpenShift(repo, 'os-1', 'staff-b')).toBe('CLOSED');
    expect(await applyToOpenShift(repo, 'os-1', 'staff-a')).toBe('WON');
  });
});

describe('その他の分岐', () => {
  it('同じ人の二重応募は ALREADY_APPLIED', async () => {
    const repo = repoWith({ mode: 'MANAGER_APPROVAL' });
    expect(await applyToOpenShift(repo, 'os-1', 'staff-a')).toBe('PENDING_APPROVAL');
    expect(await applyToOpenShift(repo, 'os-1', 'staff-a')).toBe('ALREADY_APPLIED');
  });

  it('店長承認方式は確定せず PENDING_APPROVAL のまま複数受け付ける', async () => {
    const repo = repoWith({ mode: 'MANAGER_APPROVAL' });
    const results = await Promise.all([applyToOpenShift(repo, 'os-1', 'a'), applyToOpenShift(repo, 'os-1', 'b')]);
    expect(results).toEqual(['PENDING_APPROVAL', 'PENDING_APPROVAL']);
    expect((await repo.get('os-1'))!.status).toBe('OPEN');
  });

  it('期限切れは CLOSED', async () => {
    const repo = repoWith({ expiresAt: new Date('2025-01-01T00:00:00Z') });
    expect(await applyToOpenShift(repo, 'os-1', 'a', new Date('2025-01-02T00:00:00Z'))).toBe('CLOSED');
  });

  it('存在しない募集は NOT_FOUND', async () => {
    const repo = repoWith();
    expect(await applyToOpenShift(repo, 'nope', 'a')).toBe('NOT_FOUND');
  });

  it('version が進んでいたら tryFill は失敗する(楽観ロック)', async () => {
    const repo = repoWith({ version: 3 });
    expect(await repo.tryFill('os-1', 'a', 2)).toBe(false);
    expect(await repo.tryFill('os-1', 'a', 3)).toBe(true);
    expect((await repo.get('os-1'))!.version).toBe(4);
  });
});
