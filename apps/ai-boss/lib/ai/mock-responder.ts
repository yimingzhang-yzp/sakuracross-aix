/**
 * ANTHROPIC_API_KEY 未設定時のモック応答ロジック。
 *
 * 実 API の挙動を「それらしく」再現し、キー無しでも LINE 応答・管理画面・評価スクリプトが
 * 一通り動くようにする。判定はすべて決定的(ランダム無し)。
 *
 *   ai-boss.answer  … プロンプト内の <doc> 抜粋と <question> のトークン重なり率で
 *                     high / low / no_answer を決め、根拠チャンクの冒頭を回答として返す。
 *                     人事系キーワードを含む質問は hr_redirect
 *   ai-boss.rerank  … 候補順をそのまま返す
 *   ai-boss.import  … テキストならそのまま Markdown 化、バイナリはプレースホルダ
 */
import type { AiJsonRequest, AiTextRequest, MockResponder } from '@sakura-cross/ai-client';
import { lastUserText } from '@sakura-cross/ai-client';

import { overlapRatio } from '../knowledge/tokenize';

export const MOCK_HIGH_THRESHOLD = 0.5;
export const MOCK_LOW_THRESHOLD = 0.3;

/** 個別人事に関する質問の検出(モック用の簡易ルール。実 API ではプロンプトで判断) */
export const HR_PATTERNS: RegExp[] = [
  /(私|僕|俺|自分|わたし)の(時給|給料|給与|評価|シフト)/,
  /(時給|給料|給与)(を|は)?(上げ|あげ|いくら|安い|低い|下が|減)/,
  /(評価|査定|昇給|降格|クビ|解雇|辞めさせ)/,
  /(なぜ|なんで|どうして).*(シフト|勤務).*(入れ|外|減|少な|多)/,
  /(シフト|勤務).*(入れて|増やして|減らして|外して)(ください|ほしい|欲しい)/,
  /(誰|だれ)の(時給|給料|給与)/,
  /他の(人|スタッフ|子).*(時給|給料|給与)/,
  /(全員|全スタッフ|みんな|皆).*(時給|給料|給与)/,
  /(時給|給料|給与).*(一覧|リスト|全員分)/,
];

export function looksLikeHrQuestion(text: string): boolean {
  return HR_PATTERNS.some((p) => p.test(text));
}

interface ParsedDoc {
  id: string;
  title: string;
  content: string;
}

function parseDocs(prompt: string): ParsedDoc[] {
  const docs: ParsedDoc[] = [];
  const pattern = /<doc id="([^"]+)" title="([^"]*)"[^>]*>\n?([\s\S]*?)<\/doc>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prompt)) !== null) {
    docs.push({ id: match[1]!, title: match[2]!, content: match[3]!.trim() });
  }
  return docs;
}

function parseQuestion(prompt: string): string {
  // 直前の質問が未応答のまま残っていると 1 メッセージに <question> が複数入るため、最後(=今回の質問)を取る
  const matches = [...prompt.matchAll(/<question>\n?([\s\S]*?)<\/question>/g)];
  const last = matches[matches.length - 1];
  return last ? last[1]!.trim() : prompt;
}

function firstSentences(text: string, maxChars: number): string {
  const body = text
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .join('\n')
    .trim();
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars).trimEnd()}…`;
}

function answerResponder(request: AiJsonRequest<unknown>): unknown {
  const prompt = lastUserText(request.messages);
  const question = parseQuestion(prompt);
  if (looksLikeHrQuestion(question)) {
    return { answer: '', confidence: 'hr_redirect', cited_doc_ids: [] };
  }
  const docs = parseDocs(prompt);
  let best: { doc: ParsedDoc; ratio: number } | null = null;
  for (const doc of docs) {
    const ratio = overlapRatio(question, `${doc.title}\n${doc.content}`);
    if (!best || ratio > best.ratio) best = { doc, ratio };
  }
  if (!best || best.ratio < MOCK_LOW_THRESHOLD) {
    return { answer: '', confidence: 'no_answer', cited_doc_ids: [] };
  }
  const confidence = best.ratio >= MOCK_HIGH_THRESHOLD ? 'high' : 'low';
  const excerpt = firstSentences(best.doc.content, 220);
  return {
    answer: `(モック回答)マニュアルの該当箇所です。\n${excerpt}`,
    confidence,
    cited_doc_ids: [best.doc.id],
  };
}

function rerankResponder(request: AiJsonRequest<unknown>): unknown {
  const prompt = lastUserText(request.messages);
  const ids = [...prompt.matchAll(/<chunk id="([^"]+)"/g)].map((m) => m[1]!);
  return { relevant_chunk_ids: ids };
}

function importResponder(request: AiJsonRequest<unknown>): unknown {
  const text = lastUserText(request.messages);
  const sourceMatch = /<source_text>\n?([\s\S]*?)<\/source_text>/.exec(text);
  const fileMatch = /<file_name>([^<]*)<\/file_name>/.exec(text);
  const fileName = fileMatch?.[1]?.trim() || 'アップロードファイル';
  const baseTitle = fileName.replace(/\.[^.]+$/, '');
  if (sourceMatch) {
    const body = sourceMatch[1]!.trim();
    const firstLine = body.split('\n').find((l) => l.trim()) ?? baseTitle;
    const title = firstLine.replace(/^#+\s*/, '').slice(0, 60);
    const markdown = body.startsWith('#') ? body : `# ${title}\n\n${body}`;
    return { title, markdown };
  }
  return {
    title: baseTitle,
    markdown: [
      `# ${baseTitle}`,
      '',
      '> (モック変換)ANTHROPIC_API_KEY が未設定のため、PDF / 画像の内容は読み取っていません。',
      '> API キーを設定して再度取り込むか、この本文を手で入力してください。',
      '',
      '## 【要確認】内容',
      '',
      '【店舗確認】ここにマニュアル本文を記入してください。',
    ].join('\n'),
  };
}

export const aiBossMockResponder: MockResponder = {
  json(request) {
    switch (request.purpose) {
      case 'ai-boss.answer':
        return answerResponder(request);
      case 'ai-boss.rerank':
        return rerankResponder(request);
      case 'ai-boss.import':
        return importResponder(request);
      default:
        throw new Error(`モック未対応の purpose: ${request.purpose ?? '(なし)'}`);
    }
  },
  text(request: AiTextRequest) {
    return `(モック応答: ${request.purpose ?? 'text'})`;
  },
};
