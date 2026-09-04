/**
 * npm run eval — ゴールデン QA セットで回答挙動(回答 / エスカレーション / 店長誘導 / 緊急固定応答)の一致率を測る。
 *
 *   ANTHROPIC_API_KEY あり → 実 API(claude-sonnet-4-6 等)で評価
 *   なし                   → モック(キーワード重なり率のヒューリスティック)で評価。
 *                             モックは「配線と緊急/人事ルール」の回帰確認にしか使えないことに注意
 *
 * オプション:
 *   --json <path>   結果を JSON で保存
 *   --only <id,..>  指定ケースだけ実行
 *   --verbose       応答本文も表示
 *
 * 終了コード: 一致率が passThreshold(既定 0.9)未満なら 1。
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../../.env'), quiet: true });

type Expected = 'answer' | 'escalate' | 'hr_redirect' | 'emergency';

interface GoldenCase {
  id: string;
  category: string;
  question: string;
  expected: Expected;
  expectedDocTitle?: string;
}

interface GoldenFile {
  passThreshold?: number;
  cases: GoldenCase[];
}

const KIND_TO_EXPECTED: Record<string, Expected> = {
  answered: 'answer',
  escalated: 'escalate',
  hr_redirect: 'hr_redirect',
  emergency: 'emergency',
};

function parseArgs(argv: string[]): { json?: string; only?: Set<string>; verbose: boolean } {
  const result: { json?: string; only?: Set<string>; verbose: boolean } = { verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') result.json = argv[++i];
    else if (arg === '--only') result.only = new Set((argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    else if (arg === '--verbose') result.verbose = true;
  }
  return result;
}

function pad(text: string, width: number): string {
  // 全角は 2 桁として幅を揃える
  let w = 0;
  let out = '';
  for (const ch of text) {
    const cw = /[^\x00-\x7f]/.test(ch) ? 2 : 1;
    if (w + cw > width) break;
    out += ch;
    w += cw;
  }
  return out + ' '.repeat(Math.max(0, width - w));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  process.env.AI_BOSS_SKIP_AUTO_SEED = '1';

  const { InMemoryStore } = await import('../lib/store/memory');
  const { seedKnowledge } = await import('../lib/knowledge/seed-loader');
  const { createRetriever } = await import('../lib/knowledge/retriever');
  const { handleStaffQuestion } = await import('../lib/chat/answer');
  const { DEFAULT_SETTINGS } = await import('../lib/settings');
  const { createAiClient } = await import('@sakura-cross/ai-client');
  const { aiBossMockResponder } = await import('../lib/ai/mock-responder');

  const golden = JSON.parse(await readFile(path.resolve(here, 'golden_qa.json'), 'utf8')) as GoldenFile;
  const threshold = golden.passThreshold ?? 0.9;
  const cases = args.only ? golden.cases.filter((c) => args.only!.has(c.id)) : golden.cases;

  const store = new InMemoryStore();
  await seedKnowledge(store, { seedDir: path.resolve(here, '../knowledge_seed'), updatedBy: 'eval' });
  const ai = createAiClient({
    mockResponder: aiBossMockResponder,
    logger: { info: () => undefined, warn: (m) => console.warn(m), error: (m, meta) => console.error(m, meta ?? '') },
  });
  const retriever = createRetriever(store, ai);

  console.log(`\nAI上司 ゴールデン QA 評価  モード: ${ai.mode === 'live' ? `実 API(${ai.model})` : 'モック(実 API なし)'}  ケース: ${cases.length}\n`);
  if (ai.mode === 'mock') {
    console.log('  ※ モックはナレッジとの語句重なりで回答可否を決めるだけです。回答の正しさは評価できません。\n');
  }

  const rows: {
    id: string;
    question: string;
    expected: Expected;
    actual: Expected | 'error';
    match: boolean;
    confidence: string;
    cited: string[];
    docMatch: boolean | null;
    latencyMs: number;
    reply: string;
  }[] = [];

  for (const c of cases) {
    const staff = await store.createProvisionalStaff({ lineUserId: `eval-${c.id}`, displayName: `eval ${c.id}` });
    try {
      const outcome = await handleStaffQuestion(
        { store, ai, retriever, settings: DEFAULT_SETTINGS },
        { staff, text: c.question },
      );
      const actual = KIND_TO_EXPECTED[outcome.kind] ?? 'error';
      const docMatch = c.expectedDocTitle ? outcome.citedDocTitles.includes(c.expectedDocTitle) : null;
      rows.push({
        id: c.id,
        question: c.question,
        expected: c.expected,
        actual,
        match: actual === c.expected,
        confidence: outcome.confidence,
        cited: outcome.citedDocTitles,
        docMatch,
        latencyMs: outcome.latencyMs,
        reply: outcome.replyText,
      });
    } catch (error) {
      rows.push({
        id: c.id,
        question: c.question,
        expected: c.expected,
        actual: 'error',
        match: false,
        confidence: 'error',
        cited: [],
        docMatch: null,
        latencyMs: 0,
        reply: error instanceof Error ? error.message : String(error),
      });
    }
    const row = rows[rows.length - 1]!;
    const mark = row.match ? 'OK ' : 'NG ';
    console.log(
      `${mark} ${pad(row.id, 4)} ${pad(row.expected, 12)} → ${pad(row.actual, 12)} ${pad(row.confidence, 12)} ${String(row.latencyMs).padStart(6)}ms  ${pad(row.question, 44)}${
        row.docMatch === false ? `  根拠不一致: ${row.cited.join('/') || '(なし)'}` : ''
      }`,
    );
    if (args.verbose) console.log(`      ${row.reply.replace(/\n/g, '\n      ')}\n`);
  }

  const matched = rows.filter((r) => r.match).length;
  const rate = rows.length > 0 ? matched / rows.length : 0;
  const byCategory = new Map<Expected, { total: number; ok: number }>();
  for (const r of rows) {
    const entry = byCategory.get(r.expected) ?? { total: 0, ok: 0 };
    entry.total += 1;
    if (r.match) entry.ok += 1;
    byCategory.set(r.expected, entry);
  }
  const docChecked = rows.filter((r) => r.docMatch !== null);
  const docOk = docChecked.filter((r) => r.docMatch).length;

  console.log('\n---');
  for (const [key, v] of byCategory) console.log(`  ${pad(key, 12)} ${v.ok}/${v.total}`);
  console.log(`  一致率: ${matched}/${rows.length} = ${(rate * 100).toFixed(1)}%  (合格ライン ${(threshold * 100).toFixed(0)}%)`);
  if (docChecked.length > 0) console.log(`  根拠ドキュメント一致(参考): ${docOk}/${docChecked.length}`);
  const avgLatency = rows.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, rows.length);
  console.log(`  平均応答時間: ${avgLatency.toFixed(0)}ms`);

  if (args.json) {
    await writeFile(
      args.json,
      JSON.stringify({ mode: ai.mode, model: ai.model, at: new Date().toISOString(), rate, threshold, rows }, null, 2),
      'utf8',
    );
    console.log(`  結果を保存: ${args.json}`);
  }

  if (rate < threshold) {
    console.log(`\n不合格: 一致率が ${(threshold * 100).toFixed(0)}% を下回りました。`);
    process.exit(1);
  }
  console.log('\n合格');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
