/**
 * npm run seed:knowledge — knowledge_seed/*.md を DB(または DB 未設定ならメモリ)に投入する。
 *
 *   --overwrite   店長が編集済みのドキュメントも雛形で上書きする(既定は source=seed のものだけ更新)
 *   --draft       isActive=false(ドラフト)として投入する
 *
 * ルート .env を読む(DATABASE_URL があれば Supabase へ)。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../../.env'), quiet: true });

async function main(): Promise<void> {
  const { isDatabaseConfigured, disconnectPrisma } = await import('@sakura-cross/shared-db');
  const { getStore } = await import('../lib/store');
  const { seedKnowledge } = await import('../lib/knowledge/seed-loader');

  const args = new Set(process.argv.slice(2));
  process.env.AI_BOSS_SKIP_AUTO_SEED = '1';
  const store = await getStore();
  if (!isDatabaseConfigured()) {
    console.warn('DATABASE_URL が未設定です。メモリストアに投入します(プロセス終了で消えます。動作確認用)。');
  }
  const result = await seedKnowledge(store, {
    seedDir: here,
    updatedBy: 'seed-script',
    overwriteEdited: args.has('--overwrite'),
    activate: !args.has('--draft'),
  });
  console.log(`作成: ${result.created.length} 件`);
  for (const d of result.created) console.log(`  + [${d.category}] ${d.title}`);
  console.log(`更新: ${result.updated.length} 件`);
  for (const d of result.updated) console.log(`  ~ [${d.category}] ${d.title} (v${d.version})`);
  console.log(`スキップ: ${result.skipped.length} 件`);
  for (const t of result.skipped) console.log(`  = ${t}`);
  await disconnectPrisma();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
