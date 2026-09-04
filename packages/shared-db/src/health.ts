/**
 * DB 死活確認。各アプリの /api/health から呼ぶ。
 *
 * - DATABASE_URL 未設定: status = 'skipped'(ローカルで Supabase なしでも 200 を返せる)
 * - 接続成功:            status = 'ok' + レイテンシ
 * - 失敗/タイムアウト:    status = 'error'
 */
import { getPrisma, isDatabaseConfigured } from './client.js';

export type DatabaseHealthStatus = 'ok' | 'skipped' | 'error';

export interface DatabaseHealth {
  status: DatabaseHealthStatus;
  latencyMs?: number;
  error?: string;
}

export interface PingDatabaseOptions {
  /** 既定 3000ms */
  timeoutMs?: number;
}

export async function pingDatabase(options: PingDatabaseOptions = {}): Promise<DatabaseHealth> {
  if (!isDatabaseConfigured()) {
    return { status: 'skipped' };
  }
  const timeoutMs = options.timeoutMs ?? 3000;
  const startedAt = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const prisma = getPrisma();
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`DB 応答が ${timeoutMs}ms 以内にありません`)), timeoutMs);
      }),
    ]);
    return { status: 'ok', latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      status: 'error',
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
