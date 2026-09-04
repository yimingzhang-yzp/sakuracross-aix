import { describe, expect, it } from 'vitest';

import { chunkMarkdown } from '../lib/knowledge/chunker';
import { KeywordRetriever } from '../lib/knowledge/retriever';
import { overlapRatio, tokenize } from '../lib/knowledge/tokenize';
import { createSeededStore } from './helpers';

describe('tokenize', () => {
  it('日本語は文字バイグラム、英数字は単語、助詞・定型語は落とす', () => {
    const tokens = tokenize('ドリンクチケットはPOSで処理しますか');
    expect(tokens).toContain('ドリ');
    expect(tokens).toContain('チケ');
    expect(tokens).toContain('pos');
    expect(tokens).not.toContain('は');
    expect(tokens).not.toContain('ます');
  });

  it('全角・大文字を正規化する', () => {
    expect(tokenize('ＰＯＳ')).toEqual(['pos']);
  });

  it('overlapRatio は関連文で高く、無関係で低い', () => {
    const doc = 'ドリンクチケットは当日限り有効。翌日以降・他人への譲渡・現金との交換はできない';
    expect(overlapRatio('ドリンクチケットは翌日も使えますか', doc)).toBeGreaterThan(0.5);
    expect(overlapRatio('駐車場はありますか', doc)).toBeLessThan(0.2);
  });
});

describe('KeywordRetriever', () => {
  it('質問に関連するドキュメントのチャンクを上位に返す', async () => {
    const store = await createSeededStore();
    const retriever = new KeywordRetriever(store, { revisionCheckIntervalMs: 0 });
    const results = await retriever.retrieve('ドリンクチケットは翌日も使えますか', { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.docTitle).toMatch(/エントランス|バー/);
    expect(results[0]?.content).toContain('チケット');
  });

  it('無関係な質問では空か低スコアのみ', async () => {
    const store = await createSeededStore();
    const retriever = new KeywordRetriever(store, { revisionCheckIntervalMs: 0 });
    const results = await retriever.retrieve('宇宙飛行士の訓練', { limit: 5 });
    // ヒットしても、質問側トークンの網羅率が低いのでスコアは小さい
    for (const r of results) expect(r.score).toBeLessThan(3);
  });

  it('ナレッジが更新されると次の検索に反映される(世代キャッシュ)', async () => {
    const store = await createSeededStore();
    const retriever = new KeywordRetriever(store, { revisionCheckIntervalMs: 0 });
    const before = await retriever.retrieve('ユニコーンパレードの開催手順', { limit: 3 });
    expect(before.find((r) => r.docTitle === 'ユニコーンパレード')).toBeUndefined();

    const content = '# ユニコーンパレード\n\n## 開催手順\n\nユニコーンパレードは毎月第1金曜に開催する。';
    await store.createDoc(
      { category: 'クローク・館内', title: 'ユニコーンパレード', content, isActive: true, source: 'manual', updatedBy: 't' },
      chunkMarkdown(content),
    );
    const after = await retriever.retrieve('ユニコーンパレードの開催手順', { limit: 3 });
    expect(after[0]?.docTitle).toBe('ユニコーンパレード');
  });

  it('無効化されたドキュメントは検索対象外', async () => {
    const store = await createSeededStore();
    const retriever = new KeywordRetriever(store, { revisionCheckIntervalMs: 0 });
    const docs = await store.listDocs();
    for (const d of docs) await store.updateDoc(d.id, { isActive: false, updatedBy: 't' });
    expect(await retriever.retrieve('ドリンクチケット')).toEqual([]);
  });
});
