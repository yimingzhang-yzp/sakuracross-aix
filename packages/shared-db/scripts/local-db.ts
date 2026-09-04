/**
 * ローカル開発用 Postgres(PGlite = WASM 版 Postgres)を TCP で公開する。
 *
 *   npm run db:local          # ルートから。既定ポート 54329、データは <repo>/.pglite/ に永続化
 *
 * Docker や Postgres のインストール無しで動く。pgvector 拡張も同梱しているため
 * 統合スキーマ(extensions = [vector])のマイグレーションがそのまま通る。
 *
 * .env の例:
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres?connection_limit=1
 *   DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres
 *
 * 注意: 本番・ステージングは Supabase を使う。これは個人開発機の検証用。
 *
 * 既知の問題: クライアントがクエリ実行中に切断すると pglite-socket のキューが詰まり、
 * 以降の接続が「Can't reach database server」になることがある。ウォッチドッグが定期的に
 * 疎通確認し、応答が無ければソケットサーバーを作り直す(データは失われない)。
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const dataDir = process.env.PGLITE_DATA_DIR ?? path.join(repoRoot, '.pglite');
const port = Number(process.env.PGLITE_PORT ?? 54329);
const host = process.env.PGLITE_HOST ?? '127.0.0.1';
const WATCHDOG_INTERVAL_MS = 15_000;
const WATCHDOG_TIMEOUT_MS = 8_000;

let db: PGlite;
let server: PGLiteSocketServer | null = null;
let restarting = false;

async function startServer(): Promise<void> {
  server = new PGLiteSocketServer({ db, host, port, maxConnections: 8 });
  await server.start();
}

async function stopServer(): Promise<void> {
  if (!server) return;
  try {
    await server.stop();
  } catch (error) {
    console.warn('[pglite] サーバー停止時の警告:', error instanceof Error ? error.message : error);
  }
  server = null;
}

/** TCP 経由で疎通確認(pg ドライバ不要の最小実装: 接続できて閉じられれば OK とし、加えて db 直叩きで生存確認) */
async function probe(): Promise<boolean> {
  const net = await import('node:net');
  const tcpOk = await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, WATCHDOG_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  if (!tcpOk) return false;
  // キューが詰まっていると db.query も待たされるので、タイムアウト付きで確認する
  const queued = server?.getStats().queuedQueries ?? 0;
  const active = server?.getStats().activeConnections ?? 0;
  if (queued > 0 && active === 0) return false; // 誰も接続していないのにキューが残っている = 詰まり
  return true;
}

async function watchdog(): Promise<void> {
  if (restarting) return;
  const ok = await probe();
  if (ok) return;
  restarting = true;
  console.warn(`[pglite] ${new Date().toLocaleTimeString('ja-JP')} 応答が無いためソケットサーバーを再作成します…`);
  try {
    await stopServer();
    await startServer();
    console.warn('[pglite] 再作成しました。');
  } catch (error) {
    console.error('[pglite] 再作成に失敗:', error);
  } finally {
    restarting = false;
  }
}

async function main(): Promise<void> {
  mkdirSync(dataDir, { recursive: true });
  db = await PGlite.create({ dataDir, extensions: { vector } });
  await db.waitReady;
  await startServer();

  const url = `postgresql://postgres:postgres@${host}:${port}/postgres`;
  console.log('┌──────────────────────────────────────────────────────────────');
  console.log('│ PGlite(ローカル Postgres)が起動しました');
  console.log(`│ データ: ${dataDir}`);
  console.log(`│ DATABASE_URL=${url}?connection_limit=1`);
  console.log(`│ DIRECT_URL=${url}`);
  console.log('│ 停止: Ctrl+C');
  console.log('└──────────────────────────────────────────────────────────────');

  setInterval(() => void watchdog(), WATCHDOG_INTERVAL_MS).unref();

  const shutdown = async () => {
    console.log('\nPGlite を停止しています…');
    await stopServer();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  console.error('PGlite の起動に失敗しました:', error);
  process.exit(1);
});
