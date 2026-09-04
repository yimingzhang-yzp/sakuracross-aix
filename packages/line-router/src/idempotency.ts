/**
 * webhookEventId による冪等性チェック
 *
 * LINE は同じイベントを再送することがある(`deliveryContext.isRedelivery`)。
 * イベント ID を「処理開始時に予約(claim)」し、2回目以降はスキップする。
 * ハンドラが失敗した場合は release() で予約を取り消し、再送時に再処理できるようにする。
 */

export interface WebhookEventMeta {
  eventType: string;
  /** 受信チャネル(例: 'STAFF' / 'ADMIN')。DB に記録する用途 */
  channel?: string;
  receivedAt?: Date;
}

export interface WebhookEventStore {
  /**
   * 未処理なら予約して true、既に処理済み(または予約済み)なら false を返す。
   * 実装は「INSERT の一意制約違反で判定」のように原子的であること。
   */
  tryClaim(webhookEventId: string, meta: WebhookEventMeta): Promise<boolean>;
  /**
   * 予約を取り消す(処理失敗時)。存在しなくてもエラーにしない。
   */
  release(webhookEventId: string): Promise<void>;
}

export interface InMemoryWebhookEventStoreOptions {
  /** 予約を保持する時間(ミリ秒)。既定 24 時間 */
  ttlMs?: number;
  /** 保持件数上限。超えた場合は古いものから削除。既定 10,000 */
  maxSize?: number;
  /** 現在時刻の取得(テスト用) */
  now?: () => number;
}

/**
 * プロセス内メモリで完結するストア。
 * 単一プロセスの開発・テスト用。サーバーレス(Vercel)では複数インスタンス間で共有されないため、
 * 本番では Prisma ストアを使うこと。
 */
export class InMemoryWebhookEventStore implements WebhookEventStore {
  private readonly claimed = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxSize: number;
  private readonly now: () => number;

  constructor(options: InMemoryWebhookEventStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.maxSize = options.maxSize ?? 10_000;
    this.now = options.now ?? (() => Date.now());
  }

  async tryClaim(webhookEventId: string, _meta?: WebhookEventMeta): Promise<boolean> {
    this.evict();
    if (this.claimed.has(webhookEventId)) {
      return false;
    }
    this.claimed.set(webhookEventId, this.now());
    return true;
  }

  async release(webhookEventId: string): Promise<void> {
    this.claimed.delete(webhookEventId);
  }

  /** テスト・監視用 */
  get size(): number {
    return this.claimed.size;
  }

  clear(): void {
    this.claimed.clear();
  }

  private evict(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, at] of this.claimed) {
      if (at < cutoff) {
        this.claimed.delete(id);
      }
    }
    while (this.claimed.size >= this.maxSize) {
      const oldest = this.claimed.keys().next().value;
      if (oldest === undefined) break;
      this.claimed.delete(oldest);
    }
  }
}

/**
 * Prisma クライアントの構造的サブセット。
 * `@sakura-cross/shared-db` の `ProcessedWebhookEvent` モデルに対応するが、
 * このパッケージは Prisma に依存しないよう duck typing で受け取る。
 */
export interface ProcessedWebhookEventDelegate {
  // Prisma の delegate はジェネリック関数のため、引数型は緩く受ける(実引数の形は下の実装が保証する)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(args: any): Promise<unknown>;
  /**
   * あれば優先して使う(`INSERT ... ON CONFLICT DO NOTHING` 相当)。
   * 一意制約違反を例外にしないため、エラー後に接続を切る DB(ローカル検証用の PGlite 等)でも安定する。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createMany?(args: any): Promise<{ count: number }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteMany(args: any): Promise<unknown>;
}

export interface PrismaLikeClient {
  processedWebhookEvent: ProcessedWebhookEventDelegate;
}

export interface PrismaWebhookEventStoreOptions {
  /** meta.channel が無いときの既定チャネル */
  defaultChannel: string;
}

/** Prisma の一意制約違反エラーコード */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

/**
 * DB(ProcessedWebhookEvent テーブル)を使うストア。
 * `createMany({ skipDuplicates: true })`(ON CONFLICT DO NOTHING)の件数で「既に処理済み」を判定するため、
 * 複数インスタンスでも安全。createMany が無いクライアントでは INSERT の一意制約違反(P2002)で判定する。
 */
export function createPrismaWebhookEventStore(
  client: PrismaLikeClient,
  options: PrismaWebhookEventStoreOptions,
): WebhookEventStore {
  return {
    async tryClaim(webhookEventId, meta) {
      const data = {
        webhookEventId,
        channel: meta.channel ?? options.defaultChannel,
        eventType: meta.eventType,
        receivedAt: meta.receivedAt ?? new Date(),
      };
      if (typeof client.processedWebhookEvent.createMany === 'function') {
        const result = await client.processedWebhookEvent.createMany({ data: [data], skipDuplicates: true });
        return result.count === 1;
      }
      try {
        await client.processedWebhookEvent.create({ data });
        return true;
      } catch (error) {
        if (isUniqueViolation(error)) {
          return false;
        }
        throw error;
      }
    },
    async release(webhookEventId) {
      await client.processedWebhookEvent.deleteMany({ where: { webhookEventId } });
    },
  };
}
