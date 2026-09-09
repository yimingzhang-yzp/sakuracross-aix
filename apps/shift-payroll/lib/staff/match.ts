/**
 * LINE 登録申請と既存スタッフの突き合わせ
 *
 * 申請時に本人が入力する氏名は表記が揺れる(「草野諒」「草野 諒」「くさの」など)。
 * 空白・全角半角・大小文字を吸収したキーで比較し、**一意に決まるときだけ**候補を提案する。
 * 複数該当・該当なしの場合は提案しない(店長が明示的に選ぶ)。
 */

/** 氏名の表記ゆれを吸収した比較キー。空文字なら比較対象外 */
export function nameKey(value: string | null | undefined): string {
  if (!value) return '';
  return value.normalize('NFKC').replace(/[\s　]/g, '').toLowerCase();
}

export interface MatchRequest {
  /** 本人が入力した氏名 */
  nameInput: string;
  /** 本人が入力したフリガナ */
  nameKanaInput?: string | null;
  /** LINE プロフィールの表示名 */
  displayName?: string | null;
}

export interface MatchCandidate {
  id: string;
  name: string;
  nameKana?: string | null;
}

/**
 * 申請内容に一致する既存スタッフを 1 名だけ返す。
 * 突き合わせは「入力氏名 → LINE 表示名 → フリガナ」の順に試し、
 * 最初に**ちょうど 1 件**一致した段階で確定する。
 */
export function suggestStaffMatch(request: MatchRequest, candidates: MatchCandidate[]): string | null {
  const attempts: Array<{ key: string; pick: (c: MatchCandidate) => string }> = [
    { key: nameKey(request.nameInput), pick: (c) => nameKey(c.name) },
    { key: nameKey(request.displayName), pick: (c) => nameKey(c.name) },
    { key: nameKey(request.nameKanaInput), pick: (c) => nameKey(c.nameKana) },
  ];

  for (const attempt of attempts) {
    if (!attempt.key) continue;
    const hits = candidates.filter((c) => {
      const value = attempt.pick(c);
      return value !== '' && value === attempt.key;
    });
    if (hits.length === 1) return hits[0]!.id;
  }
  return null;
}
