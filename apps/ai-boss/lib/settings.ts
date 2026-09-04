/**
 * 管理画面から変更可能な設定値(AppSetting テーブル)。ハードコード禁止の原則に従い、
 * 文言・しきい値はすべてここで既定値を定義し、DB に値があればそちらを優先する。
 */
import { z } from 'zod';

export const emergencyRuleSchema = z.object({
  id: z.string().min(1),
  /** いずれかを含めば発火(部分一致・大文字小文字無視) */
  keywords: z.array(z.string().min(1)).min(1),
  title: z.string().min(1),
  /** 固定応答本文(RAG を介さず即時返信) */
  response: z.string().min(1),
});
export type EmergencyRule = z.infer<typeof emergencyRuleSchema>;

export const aiBossSettingsSchema = z.object({
  /** 友だち追加時のあいさつ。記録・閲覧の明示を必ず含める */
  greeting: z.string().min(1),
  /** 初回応答などに付ける記録告知文 */
  loggingNotice: z.string().min(1),
  /** ナレッジに根拠が無いときの返答 */
  escalationReply: z.string().min(1),
  /** 確信度が低いときに回答末尾へ付ける注意書き */
  lowConfidenceSuffix: z.string().min(1),
  /** 個別人事に関する質問への誘導文 */
  hrRedirectReply: z.string().min(1),
  /** 店長が未回答キューで回答したときに LINE で届ける文のテンプレート({{answer}} / {{question}}) */
  managerAnswerTemplate: z.string().min(1),
  /** 画像・スタンプなどテキスト以外を受けたときの返答 */
  nonTextReply: z.string().min(1),
  /** 緊急時の責任者連絡先(固定応答の末尾に付く) */
  managerContact: z.string().min(1),
  /** 回答の目安文字数(プロンプトに埋め込む) */
  answerMaxChars: z.number().int().min(100).max(2000),
  /** 会話セッションの無応答タイムアウト(分) */
  sessionMinutes: z.number().int().min(5).max(240),
  /** 文脈として渡す最大往復数 */
  maxTurns: z.number().int().min(1).max(30),
  /** 検索で取得するチャンク数 */
  retrieveLimit: z.number().int().min(3).max(30),
  emergencyRules: z.array(emergencyRuleSchema),
});
export type AiBossSettings = z.infer<typeof aiBossSettingsSchema>;

export const SETTINGS_KEY = 'ai-boss.settings';

export const LOGGING_NOTICE = 'この会話は教育品質向上のため記録され、店長が閲覧できます。';

export const DEFAULT_SETTINGS: AiBossSettings = {
  greeting: [
    'CROSS ROPPONGI の AI上司です。',
    '業務のわからないことは、いつでもこのトークに質問してください。店のマニュアルに基づいてお答えします。',
    'マニュアルに無いことは「店長に確認します」とお伝えし、店長から回答が届きます。',
    '',
    `※${LOGGING_NOTICE}`,
  ].join('\n'),
  loggingNotice: LOGGING_NOTICE,
  escalationReply:
    'この件はマニュアルに記載がないため店長に確認します。回答が届いたらこのトークでお知らせします。急ぎの場合はその場の責任者に直接確認してください。',
  lowConfidenceSuffix: '※マニュアルの記載から確信を持って答えられない部分があるため、店長にも確認しています。',
  hrRedirectReply:
    '給与・評価・シフトの割り当てなど個人に関わることは、このトークではお答えできません。店長へ直接ご確認ください。',
  managerAnswerTemplate: '【店長からの回答】\nご質問:{{question}}\n\n{{answer}}',
  nonTextReply:
    '画像やスタンプでの質問には現在対応していません(画像での質問は今後対応予定です)。文章で質問を送ってください。',
  managerContact: '責任者連絡先: 【店舗確認】店長 000-0000-0000 / 副店長 000-0000-0000',
  answerMaxChars: 300,
  sessionMinutes: 30,
  maxTurns: 10,
  retrieveLimit: 12,
  emergencyRules: [
    {
      id: 'medical',
      keywords: ['救急', '救急車', '急病', '倒れた', '倒れて', '意識がない', '意識なし', '呼吸', 'けいれん', '痙攣'],
      title: '救急・体調不良者',
      response: [
        '【緊急:救急対応】',
        '1. 安全な場所へ移動させ、意識・呼吸を確認',
        '2. 意識がない/呼吸がおかしい → 迷わず 119 に通報(場所:六本木 CROSS ROPPONGI)',
        '3. その場の責任者に即時連絡。AED は【店舗確認】に設置',
        '4. 嘔吐がある場合は横向きに。飲食物・薬は与えない',
        '5. 救急隊到着まで一人にしない。到着後は状況を簡潔に伝える',
      ].join('\n'),
    },
    {
      id: 'fire',
      keywords: ['火事', '火災', '煙が', '燃えて', '焦げ', '火が出'],
      title: '火災',
      response: [
        '【緊急:火災対応】',
        '1. 大声で周囲に知らせ、火災報知器を押す',
        '2. 初期消火は消火器で(天井に届く火は消火をやめて避難)',
        '3. 119 に通報(場所:六本木 CROSS ROPPONGI)',
        '4. お客様を避難経路【店舗確認】から誘導。エレベーターは使わない',
        '5. 責任者に即時連絡。点呼を取り、逃げ遅れがないか確認',
      ].join('\n'),
    },
    {
      id: 'police',
      keywords: ['警察', '110', '刃物', 'ナイフ', '暴力', '殴られ', '喧嘩が', 'けんかが', '暴れて', '盗難', '盗まれ'],
      title: '警察対応・暴力・盗難',
      response: [
        '【緊急:警察・暴力・盗難】',
        '1. 自分の安全を最優先。無理に制止しない',
        '2. セキュリティと責任者に即時連絡',
        '3. 刃物・けが人・収まらない暴力 → 110 に通報',
        '4. 関係者・目撃者の特徴を記録(服装・人数・逃走方向)。現場は触らない',
        '5. 盗難・紛失は本人と一緒に責任者へ。届出は責任者の指示に従う',
      ].join('\n'),
    },
    {
      id: 'earthquake',
      keywords: ['地震', '揺れ', '停電'],
      title: '地震・停電',
      response: [
        '【緊急:地震・停電】',
        '1. 揺れている間は頭を守り、落下物(ボトル・照明)から離れる',
        '2. 揺れが収まったら責任者の指示で避難誘導。出口を開放し混乱を防ぐ',
        '3. 停電時は非常灯を確認し、お客様を落ち着かせる。会計は責任者の判断',
        '4. ガス・火元を確認。異臭があれば火気厳禁で通報',
      ].join('\n'),
    },
  ],
};

/**
 * DB の値(部分的でもよい)と既定値をマージして完全な設定を返す。
 * 不正な値は既定値にフォールバックし、例外にしない(設定ミスで Bot が止まらないように)。
 */
export function resolveSettings(stored: unknown): AiBossSettings {
  if (!stored || typeof stored !== 'object') return DEFAULT_SETTINGS;
  const merged = { ...DEFAULT_SETTINGS, ...(stored as Record<string, unknown>) };
  const parsed = aiBossSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}
