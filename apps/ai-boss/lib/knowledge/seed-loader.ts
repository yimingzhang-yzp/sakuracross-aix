/**
 * `knowledge_seed/*.md` を読み込んでストアに投入する(シードスクリプトと、DB 未設定時の自動投入で共用)。
 *
 * ファイル名規約: `NN_<category-key>.md`(例: 03_id-check.md)。カテゴリ名は categories.ts から解決する。
 * タイトルは本文の最初の `# 見出し`。
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { chunkMarkdown, extractTitle } from './chunker';
import { findCategoryByKey } from './categories';
import type { AiBossStore, KnowledgeDocRecord } from '../store/types';

export interface SeedDoc {
  file: string;
  categoryKey: string;
  category: string;
  title: string;
  content: string;
}

export function resolveSeedDir(baseDir: string = process.cwd()): string {
  return path.resolve(baseDir, 'knowledge_seed');
}

export async function loadSeedDocs(seedDir: string = resolveSeedDir()): Promise<SeedDoc[]> {
  const entries = (await readdir(seedDir)).filter((f) => f.endsWith('.md')).sort();
  const docs: SeedDoc[] = [];
  for (const file of entries) {
    const match = /^\d+_([a-z0-9-]+)\.md$/i.exec(file);
    if (!match) continue;
    const categoryKey = match[1]!;
    const category = findCategoryByKey(categoryKey);
    if (!category) {
      throw new Error(`knowledge_seed/${file}: 未知のカテゴリキー "${categoryKey}"(lib/knowledge/categories.ts を確認)`);
    }
    const content = await readFile(path.join(seedDir, file), 'utf8');
    const title = extractTitle(content);
    if (!title) throw new Error(`knowledge_seed/${file}: 先頭に "# タイトル" が必要です`);
    docs.push({ file, categoryKey, category: category.name, title, content });
  }
  return docs;
}

export interface SeedResult {
  created: KnowledgeDocRecord[];
  updated: KnowledgeDocRecord[];
  skipped: string[];
}

/**
 * タイトル + カテゴリが一致する既存ドキュメントがあれば本文を更新(内容が同じならスキップ)、無ければ作成する。
 * 店長が編集済みのドキュメントを上書きしないよう、`overwriteEdited=false`(既定)では source が "seed" のものだけ更新する。
 */
export async function seedKnowledge(
  store: AiBossStore,
  options: { seedDir?: string; updatedBy?: string; overwriteEdited?: boolean; activate?: boolean } = {},
): Promise<SeedResult> {
  const updatedBy = options.updatedBy ?? 'seed';
  const docs = await loadSeedDocs(options.seedDir);
  const existing = await store.listDocs({ includeInactive: true });
  const result: SeedResult = { created: [], updated: [], skipped: [] };

  for (const seed of docs) {
    const chunks = chunkMarkdown(seed.content);
    const match = existing.find((d) => d.title === seed.title && d.category === seed.category);
    if (!match) {
      result.created.push(
        await store.createDoc(
          {
            category: seed.category,
            title: seed.title,
            content: seed.content,
            isActive: options.activate ?? true,
            source: 'seed',
            updatedBy,
          },
          chunks,
        ),
      );
      continue;
    }
    if (match.content === seed.content) {
      result.skipped.push(seed.title);
      continue;
    }
    if (match.source !== 'seed' && !options.overwriteEdited) {
      result.skipped.push(`${seed.title}(店長編集済みのため保持)`);
      continue;
    }
    result.updated.push(await store.updateDoc(match.id, { content: seed.content, updatedBy }, chunks));
  }
  return result;
}
