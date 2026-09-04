/**
 * 日本語向けの簡易トークナイズ(形態素解析なし)。
 *
 * - NFKC 正規化 → 小文字化 → 記号・空白で分割
 * - 日本語(かな・漢字)の連続は文字バイグラムに分解(「ドリンクチケット」→ ドリ/リン/ンク/…)
 * - 英数字の連続は単語としてそのまま 1 トークン(「pos」「vip」「id」)
 * - 助詞・助動詞だけのトークンやひらがな 1 文字は落とす
 *
 * 全文検索拡張(pg_bigm / PGroonga)に依存せず、Supabase にそのまま入る方式(ASSUMPTIONS.md 参照)。
 */

const SPLIT_PATTERN = /[\s\p{P}\p{S}]+/u;
const LATIN_PATTERN = /^[a-z0-9]+$/;

/**
 * 検索ノイズになりやすい語(質問文の定型部分)。バイグラム化する前に除去する。
 * 「お客様」「店長」「責任者」「スタッフ」はほぼ全ドキュメントに出るため、質問側では識別力が無い。
 */
const STOP_PHRASES = [
  'お客様',
  'お客さん',
  'スタッフ',
  '店長',
  '責任者',
  '教えて',
  'ください',
  'について',
  'ですか',
  'ますか',
  'でしょうか',
  'ください',
  'したい',
  'したら',
  'すれば',
  'どう',
  'どの',
  'なに',
  '何',
  'いい',
  'よい',
  'よう',
  'こと',
  'もの',
  'とき',
  'ばあい',
  '場合',
  'それ',
  'これ',
  'あれ',
  'って',
  'って',
  'です',
  'ます',
  'した',
  'する',
  'され',
  'れる',
  'ない',
  'ある',
  'いる',
  'から',
  'まで',
  'ので',
  'けど',
  'でも',
  'また',
  'そして',
  'は',
  'が',
  'を',
  'に',
  'へ',
  'と',
  'の',
  'も',
  'や',
  'で',
  'か',
  'ね',
  'よ',
  'な',
];

export function normalizeText(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

function stripStopPhrases(segment: string): string {
  let result = segment;
  // 長いものから順に除去(「について」を先に消してから「に」を消す)
  for (const phrase of STOP_PHRASES) {
    if (phrase.length >= 2) {
      result = result.split(phrase).join(' ');
    }
  }
  return result;
}

function isKana1(token: string): boolean {
  return token.length === 1 && /[぀-ヿ]/.test(token);
}

/**
 * テキストをトークン集合(重複あり配列)に変換する。
 */
export function tokenize(text: string, options: { stripStop?: boolean } = {}): string[] {
  const stripStop = options.stripStop ?? true;
  const normalized = normalizeText(text);
  const segments = normalized.split(SPLIT_PATTERN).filter(Boolean);
  const tokens: string[] = [];

  for (const rawSegment of segments) {
    const segment = stripStop ? stripStopPhrases(rawSegment) : rawSegment;
    for (const piece of segment.split(/\s+/).filter(Boolean)) {
      if (LATIN_PATTERN.test(piece)) {
        tokens.push(piece);
        continue;
      }
      // ラテン文字と日本語が混在する場合は種類ごとに分ける
      const runs = piece.match(/[a-z0-9]+|[^a-z0-9]+/g) ?? [];
      for (const run of runs) {
        if (LATIN_PATTERN.test(run)) {
          tokens.push(run);
          continue;
        }
        const chars = Array.from(run);
        if (chars.length === 1) {
          if (!isKana1(run) && !(stripStop && STOP_PHRASES.includes(run))) tokens.push(run);
          continue;
        }
        for (let i = 0; i < chars.length - 1; i += 1) {
          const bigram = chars[i]! + chars[i + 1]!;
          tokens.push(bigram);
        }
      }
    }
  }
  return tokens;
}

export function uniqueTokens(text: string, options?: { stripStop?: boolean }): Set<string> {
  return new Set(tokenize(text, options));
}

/**
 * 2 つのテキストのトークン重なり率(質問側基準)。0〜1。モックの回答可否判定に使う。
 */
export function overlapRatio(query: string, target: string): number {
  const q = uniqueTokens(query);
  if (q.size === 0) return 0;
  const t = uniqueTokens(target, { stripStop: false });
  let hit = 0;
  for (const token of q) if (t.has(token)) hit += 1;
  return hit / q.size;
}
