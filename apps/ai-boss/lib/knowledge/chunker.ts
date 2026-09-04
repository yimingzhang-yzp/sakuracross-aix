/**
 * Markdown を見出し単位で分割し、最大文字数(既定 800 字)に収めるチャンク分割。
 *
 * - `#` 〜 `####` の見出しで区切る。見出しパス(「VIP業務 > ボトルの入れ方」)を heading に持つ
 * - 1 セクションが上限を超える場合は段落(空行)単位で分け、それでも超える段落は文で分ける
 * - 各チャンクの本文先頭に見出しパスを含めることで、チャンク単独でも文脈が分かるようにする
 */

export interface ChunkInput {
  chunkIndex: number;
  heading: string | null;
  content: string;
}

export interface ChunkOptions {
  /** 既定 800 */
  maxChars?: number;
  /** 見出しパスを本文先頭に付与する(既定 true) */
  prependHeading?: boolean;
}

const HEADING_PATTERN = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const SENTENCE_SPLIT = /(?<=[。!?！？\n])/u;

interface Section {
  headingPath: string[];
  lines: string[];
}

function splitSections(markdown: string): Section[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const sections: Section[] = [];
  let current: Section = { headingPath: [], lines: [] };
  const stack: { level: number; title: string }[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      current.lines.push(line);
      continue;
    }
    const match = inCodeBlock ? null : HEADING_PATTERN.exec(line);
    if (!match) {
      current.lines.push(line);
      continue;
    }
    if (current.lines.some((l) => l.trim())) sections.push(current);
    const level = match[1]!.length;
    const title = match[2]!.trim();
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
    stack.push({ level, title });
    current = { headingPath: stack.map((s) => s.title), lines: [] };
  }
  if (current.lines.some((l) => l.trim())) sections.push(current);
  return sections;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function hardSplit(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let buffer = '';
  for (const sentence of text.split(SENTENCE_SPLIT)) {
    if (!sentence) continue;
    if ((buffer + sentence).length > maxChars && buffer) {
      pieces.push(buffer.trim());
      buffer = '';
    }
    if (sentence.length > maxChars) {
      // 1 文が上限を超える場合は文字数で機械的に切る
      for (let i = 0; i < sentence.length; i += maxChars) {
        pieces.push(sentence.slice(i, i + maxChars).trim());
      }
      continue;
    }
    buffer += sentence;
  }
  if (buffer.trim()) pieces.push(buffer.trim());
  return pieces;
}

function packParagraphs(paragraphs: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let buffer = '';
  for (const paragraph of paragraphs) {
    const parts = paragraph.length > maxChars ? hardSplit(paragraph, maxChars) : [paragraph];
    for (const part of parts) {
      const candidate = buffer ? `${buffer}\n\n${part}` : part;
      if (candidate.length > maxChars && buffer) {
        chunks.push(buffer);
        buffer = part;
      } else {
        buffer = candidate;
      }
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

export function chunkMarkdown(markdown: string, options: ChunkOptions = {}): ChunkInput[] {
  const maxChars = options.maxChars ?? 800;
  const prependHeading = options.prependHeading ?? true;
  const chunks: ChunkInput[] = [];

  for (const section of splitSections(markdown)) {
    const heading = section.headingPath.length > 0 ? section.headingPath.join(' > ') : null;
    const headingPrefix = prependHeading && heading ? `${heading}\n` : '';
    const bodyBudget = Math.max(100, maxChars - headingPrefix.length);
    const body = section.lines.join('\n').trim();
    if (!body) continue;
    for (const piece of packParagraphs(splitParagraphs(body), bodyBudget)) {
      chunks.push({ chunkIndex: chunks.length, heading, content: `${headingPrefix}${piece}` });
    }
  }
  return chunks;
}

/** Markdown の最初の `# 見出し` をタイトルとして取り出す(無ければ null) */
export function extractTitle(markdown: string): string | null {
  for (const line of markdown.split('\n')) {
    const match = /^#\s+(.+?)\s*$/.exec(line.trim());
    if (match) return match[1]!.trim();
  }
  return null;
}
