#!/usr/bin/env node
/**
 * prisma generate のラッパー。
 *
 * スキーマとエンジン種別が前回生成時と同じなら生成をスキップする。
 * 理由: Windows で開発サーバーが query-engine を実行中だと、生成時の実行ファイル上書きが
 *       EPERM で失敗するため(`npm run test` / `npm run build` が dev 稼働中に落ちる)。
 * 強制的に再生成したいときは `PRISMA_FORCE_GENERATE=1 npm run generate`。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const repoRoot = path.resolve(pkgRoot, '../..');
loadEnv({ path: path.join(repoRoot, '.env'), quiet: true });

const schemaPath = path.join(pkgRoot, 'prisma', 'schema.prisma');
const clientDir = path.join(repoRoot, 'node_modules', '.prisma', 'client');
const stampPath = path.join(clientDir, '.sakura-cross-generate-stamp');

const engineType = process.env.PRISMA_CLIENT_ENGINE_TYPE ?? 'library';
const hash = createHash('sha256').update(readFileSync(schemaPath)).update(`|engine=${engineType}|prisma=6.19.3`).digest('hex');

const clientExists = existsSync(path.join(clientDir, 'index.js'));
const previous = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : null;

if (!process.env.PRISMA_FORCE_GENERATE && clientExists && previous === hash) {
  console.log(`[shared-db] Prisma Client は最新です(engine=${engineType})。生成をスキップします。`);
  process.exit(0);
}

const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['prisma', 'generate'], {
  cwd: pkgRoot,
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});
if (result.status !== 0) {
  console.error('[shared-db] prisma generate に失敗しました。開発サーバー(next dev)が起動中の場合は停止してから再実行してください。');
  process.exit(result.status ?? 1);
}
writeFileSync(stampPath, hash);
