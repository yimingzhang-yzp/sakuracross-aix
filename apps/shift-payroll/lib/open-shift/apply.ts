/**
 * 欠員募集への応募(先着順の排他制御)
 *
 * 同時タップに備え、「status = OPEN かつ version = 期待値」の行を条件付き UPDATE で FILLED にする。
 * 更新件数が 1 のときだけ勝者になる。DB の行ロックにより同時実行でも 1 名しか確定しない。
 * リポジトリを差し替え可能にして、フェイク実装で単体テスト、Prisma 実装で統合テストを行う。
 */

export type OpenShiftMode = 'FIRST_COME' | 'MANAGER_APPROVAL';

export interface OpenShiftSnapshot {
  id: string;
  status: 'OPEN' | 'FILLED' | 'EXPIRED';
  version: number;
  mode: OpenShiftMode;
  filledByStaffId: string | null;
  expiresAt: Date | null;
}

export type ApplyOutcome =
  | 'WON' // 先着で確定
  | 'LOST' // 先に決まっていた
  | 'PENDING_APPROVAL' // 店長承認待ちとして受付
  | 'ALREADY_APPLIED' // 同じ人の二重応募
  | 'CLOSED' // 募集終了・期限切れ
  | 'NOT_FOUND';

export interface OpenShiftRepository {
  get(openShiftId: string): Promise<OpenShiftSnapshot | null>;
  /** 応募を記録。既に同じ組み合わせがあれば false */
  recordApplication(openShiftId: string, staffId: string): Promise<boolean>;
  /** 原子的な確定。更新できたら true */
  tryFill(openShiftId: string, staffId: string, expectedVersion: number): Promise<boolean>;
  /** 応募レコードの状態更新 */
  setApplicationStatus(openShiftId: string, staffId: string, status: 'WON' | 'LOST'): Promise<void>;
}

export async function applyToOpenShift(
  repo: OpenShiftRepository,
  openShiftId: string,
  staffId: string,
  now: Date = new Date(),
): Promise<ApplyOutcome> {
  const snapshot = await repo.get(openShiftId);
  if (!snapshot) return 'NOT_FOUND';
  if (snapshot.status !== 'OPEN') return snapshot.filledByStaffId === staffId ? 'WON' : 'CLOSED';
  if (snapshot.expiresAt && snapshot.expiresAt <= now) return 'CLOSED';

  const recorded = await repo.recordApplication(openShiftId, staffId);
  if (!recorded) return 'ALREADY_APPLIED';

  if (snapshot.mode === 'MANAGER_APPROVAL') {
    return 'PENDING_APPROVAL';
  }

  const won = await repo.tryFill(openShiftId, staffId, snapshot.version);
  await repo.setApplicationStatus(openShiftId, staffId, won ? 'WON' : 'LOST');
  return won ? 'WON' : 'LOST';
}

/**
 * テスト・開発用のメモリ実装。
 * get と tryFill の間で他の応募が割り込めるよう、各操作の前に 1 tick 譲る。
 */
export class InMemoryOpenShiftRepository implements OpenShiftRepository {
  readonly applications = new Map<string, { staffId: string; status: string }[]>();

  constructor(private readonly rows: Map<string, OpenShiftSnapshot>) {}

  private async yieldTick(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async get(openShiftId: string): Promise<OpenShiftSnapshot | null> {
    await this.yieldTick();
    const row = this.rows.get(openShiftId);
    return row ? { ...row } : null;
  }

  async recordApplication(openShiftId: string, staffId: string): Promise<boolean> {
    await this.yieldTick();
    const list = this.applications.get(openShiftId) ?? [];
    if (list.some((a) => a.staffId === staffId)) return false;
    list.push({ staffId, status: 'APPLIED' });
    this.applications.set(openShiftId, list);
    return true;
  }

  async tryFill(openShiftId: string, staffId: string, expectedVersion: number): Promise<boolean> {
    await this.yieldTick();
    // ここは同期的な check-and-set(DB の条件付き UPDATE に相当)
    const row = this.rows.get(openShiftId);
    if (!row || row.status !== 'OPEN' || row.version !== expectedVersion) return false;
    this.rows.set(openShiftId, { ...row, status: 'FILLED', filledByStaffId: staffId, version: row.version + 1 });
    return true;
  }

  async setApplicationStatus(openShiftId: string, staffId: string, status: 'WON' | 'LOST'): Promise<void> {
    const list = this.applications.get(openShiftId) ?? [];
    const app = list.find((a) => a.staffId === staffId);
    if (app) app.status = status;
  }
}
