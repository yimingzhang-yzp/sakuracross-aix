/**
 * Prisma Client のシングルトン
 *
 * - Next.js の開発モード(HMR)で接続が増殖しないよう globalThis にキャッシュする
 * - DATABASE_URL 未設定時はインスタンス化せず、`getPrisma()` 呼び出し時に明示的な例外にする
 *   (ヘルスチェック等では `isDatabaseConfigured()` で事前判定する)
 */
import prismaPkg from '@prisma/client';
import type { PrismaClient as PrismaClientType } from '@prisma/client';

const { PrismaClient } = prismaPkg;

export type PrismaClientInstance = PrismaClientType;

type GlobalWithPrisma = typeof globalThis & {
  __sakuraCrossPrisma?: PrismaClientInstance;
};

const globalRef = globalThis as GlobalWithPrisma;

export function isDatabaseConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.DATABASE_URL && env.DATABASE_URL.trim());
}

export function getPrisma(): PrismaClientInstance {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'DATABASE_URL が未設定です。ルートの .env に Supabase の接続文字列を設定してください(SETUP.md 参照)。',
    );
  }
  if (!globalRef.__sakuraCrossPrisma) {
    globalRef.__sakuraCrossPrisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return globalRef.__sakuraCrossPrisma;
}

/**
 * 接続を明示的に閉じる(スクリプト・テストの後始末用)。
 */
export async function disconnectPrisma(): Promise<void> {
  if (globalRef.__sakuraCrossPrisma) {
    await globalRef.__sakuraCrossPrisma.$disconnect();
    globalRef.__sakuraCrossPrisma = undefined;
  }
}
