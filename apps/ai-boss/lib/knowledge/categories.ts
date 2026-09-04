/**
 * ナレッジの初期カテゴリ(指示書 02 §3.1)。
 * カテゴリは KnowledgeDoc.category に文字列で保存する。管理画面では追加も可能だが、
 * 初期 10 カテゴリの並び順・説明はここで定義する。
 */
export interface KnowledgeCategory {
  /** ファイル名・URL に使う英数字キー */
  key: string;
  /** 表示名 = KnowledgeDoc.category の値 */
  name: string;
  description: string;
  /** 法令・年齢確認など、要約を歪めず保守的に答えるべきカテゴリ */
  sensitive: boolean;
}

export const KNOWLEDGE_CATEGORIES: readonly KnowledgeCategory[] = [
  { key: 'service', name: '接客基本', description: '挨拶、身だしなみ、言葉遣い、外国人対応の基本英語フレーズ', sensitive: false },
  { key: 'entrance', name: 'エントランス業務', description: 'ドアチャージ料金体系、ゲストリスト運用、ドリンクチケット、再入場ルール', sensitive: false },
  { key: 'id-check', name: 'IDチェック・年齢確認', description: '手順、確認書類の種類、疑わしい場合の対応(最重要)', sensitive: true },
  { key: 'bar', name: 'バー業務', description: 'ドリンクレシピ、グラスの種類、POS操作手順、ドリンクチケットの処理', sensitive: false },
  { key: 'vip', name: 'VIP・テーブル業務', description: '伝票の書き方、ボトル・シャンパンコール、ミニマムチャージ、コンプの承認ルール', sensitive: false },
  { key: 'trouble', name: 'トラブル対応', description: '泥酔客、喧嘩、盗難・紛失、体調不良者・救急、警察対応の一次手順', sensitive: false },
  { key: 'compliance', name: '法令・コンプライアンス', description: '風営法上の禁止事項、営業時間ルール、騒音・客引きに関する注意', sensitive: true },
  { key: 'cloak', name: 'クローク・館内', description: '預かりルール、忘れ物処理、清掃基準', sensitive: false },
  { key: 'hr-rules', name: '勤怠・給与・店内ルール', description: 'シフト提出方法、日払い申請、休憩ルール', sensitive: false },
  { key: 'emergency', name: '緊急連絡', description: '避難経路、火災・地震時の対応、責任者連絡フロー', sensitive: false },
] as const;

export const CATEGORY_NAMES: readonly string[] = KNOWLEDGE_CATEGORIES.map((c) => c.name);

export function findCategoryByKey(key: string): KnowledgeCategory | undefined {
  return KNOWLEDGE_CATEGORIES.find((c) => c.key === key);
}

export function isSensitiveCategory(name: string): boolean {
  return KNOWLEDGE_CATEGORIES.some((c) => c.name === name && c.sensitive);
}
