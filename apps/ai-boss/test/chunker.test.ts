import { describe, expect, it } from 'vitest';

import { chunkMarkdown, extractTitle } from '../lib/knowledge/chunker';

const SAMPLE = `# VIPマニュアル

前置きの段落。

## ボトルの入れ方

1. 注文を復唱する
2. POS に入力する

### 注意

コルクを人に向けない。

## コンプ

責任者の承認が必要。
`;

describe('chunkMarkdown', () => {
  it('見出し単位で分割し、見出しパスを heading と本文先頭に持つ', () => {
    const chunks = chunkMarkdown(SAMPLE);
    expect(chunks.map((c) => c.heading)).toEqual([
      'VIPマニュアル',
      'VIPマニュアル > ボトルの入れ方',
      'VIPマニュアル > ボトルの入れ方 > 注意',
      'VIPマニュアル > コンプ',
    ]);
    expect(chunks[1]?.content.startsWith('VIPマニュアル > ボトルの入れ方\n')).toBe(true);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2, 3]);
  });

  it('上限文字数を超えるセクションは段落で分ける', () => {
    const paragraph = 'あ'.repeat(300);
    const md = `# 長い\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}`;
    const chunks = chunkMarkdown(md, { maxChars: 700 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(700);
  });

  it('1 段落が上限を超える場合も文単位で切って上限を守る', () => {
    const sentence = 'これは文です。';
    const md = `# 長文\n\n${sentence.repeat(200)}`;
    const chunks = chunkMarkdown(md, { maxChars: 400 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(400);
  });

  it('コードブロック内の # は見出しとして扱わない', () => {
    const md = '# タイトル\n\n```\n# not heading\n```\n\n本文';
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading).toBe('タイトル');
  });

  it('extractTitle は最初の # 見出しを返す', () => {
    expect(extractTitle(SAMPLE)).toBe('VIPマニュアル');
    expect(extractTitle('本文だけ')).toBeNull();
  });

  it('空文字は空配列', () => {
    expect(chunkMarkdown('')).toEqual([]);
  });
});
