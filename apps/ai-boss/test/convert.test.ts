import { MockAiClient } from '@sakura-cross/ai-client';
import { describe, expect, it } from 'vitest';

import { aiBossMockResponder } from '../lib/ai/mock-responder';
import { convertToMarkdown, detectImportKind } from '../lib/import/convert';

describe('detectImportKind', () => {
  it('MIME と拡張子から種別を判定する', () => {
    expect(detectImportKind('a.pdf', 'application/pdf')?.kind).toBe('pdf');
    expect(detectImportKind('a.pdf', 'application/octet-stream')?.kind).toBe('pdf');
    expect(detectImportKind('a.docx', '')?.kind).toBe('docx');
    expect(detectImportKind('photo.JPG', 'image/jpeg')).toEqual({ kind: 'image', mimeType: 'image/jpeg' });
    expect(detectImportKind('manual.md', 'text/markdown')?.kind).toBe('text');
    expect(detectImportKind('a.exe', 'application/x-msdownload')).toBeNull();
  });
});

describe('convertToMarkdown', () => {
  const ai = new MockAiClient({ responder: aiBossMockResponder });

  it('テキストファイルは Markdown として取り込み、タイトルを抽出する', async () => {
    const text = 'ドレスコード\n\nサンダル禁止。\n';
    const result = await convertToMarkdown(ai, {
      fileName: 'dresscode.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from(text, 'utf8'),
      category: '接客基本',
    });
    expect(result.kind).toBe('text');
    expect(result.title).toBe('ドレスコード');
    expect(result.markdown.startsWith('# ドレスコード')).toBe(true);
    expect(result.markdown).toContain('サンダル禁止');
  });

  it('PDF はモックでは雛形 + 警告を返す', async () => {
    const result = await convertToMarkdown(ai, {
      fileName: 'manual.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4 dummy'),
      category: 'バー業務',
    });
    expect(result.kind).toBe('pdf');
    expect(result.warnings.some((w) => w.includes('モック'))).toBe(true);
    expect(result.markdown).toContain('# manual');
  });

  it('対応外の形式・空ファイルはエラー', async () => {
    await expect(
      convertToMarkdown(ai, { fileName: 'x.exe', mimeType: 'application/x-msdownload', bytes: Buffer.from('a'), category: 'c' }),
    ).rejects.toThrow(/対応していない/);
    await expect(convertToMarkdown(ai, { fileName: 'x.txt', mimeType: 'text/plain', bytes: Buffer.alloc(0), category: 'c' })).rejects.toThrow(
      /空/,
    );
  });
});
