# ASSUMPTIONS — 基盤構築時の質問・仮定・設計判断

モノレポ基盤(フェーズ0)を構築するにあたり、指示書から一意に決まらなかった点を **質問 → 置いた仮定 → 影響範囲** の形で記録します。
回答をいただければ該当箇所を修正します。仮定はいずれも後続フェーズで変更可能な範囲に留めています。

最終更新: 2026-09-03(AI上司フェーズ1 の決定事項を A2 に追記)

---

## A. 確認したい質問(未回答。以下の仮定で進めています)

### Q1. 「CROSS スタッフ」アカウントの Webhook URL はどのアプリが受けるか

共通前提書は「1 つの Webhook エンドポイントで受けて振り分ける」としていますが、`apps/shift-payroll` と `apps/ai-boss` は別デプロイ(別ドメイン)になります。

- **2026-09-03 決定 → A2 参照: ai-boss が直接受ける(下記の仮定は撤回)**
- **当初の仮定**: `apps/shift-payroll` の `/api/line/webhook` が受信し、`packages/line-router` で振り分けたうえで、`ai` 宛てイベントは `apps/ai-boss` の内部 API(`/api/internal/line-event`、共有シークレット `INTERNAL_API_SECRET` で認証)へ HTTPS で転送する
- **理由**: スタッフ登録(`Staff.lineUserId` 紐付け)と follow イベントの主管がシフト側であるため
- **代替案**: (a) ai-boss が受けて shift へ転送 (b) 共有 DB の `Job` テーブル経由(応答遅延が大きく AI チャットに不向き)
- **影響**: `.env.example` に `INTERNAL_API_SECRET` を追加済み。実装はフェーズ1

### Q2. follow / unfollow イベントの扱い

- **仮定**: **両システムへ配信**(`RouteTarget = 'both'`)。シフト側は仮登録レコード作成、AI 側は「会話が記録・閲覧される」旨のあいさつを送る(指示書 02 §4.1 の必須要件)
- **代替案**: シフト側のみに配信し、あいさつもシフト側が代行する

### Q3. 管理画面ユーザー(Supabase Auth)と Staff の関係

- **仮定**: `Staff` に `authUserId`(Supabase Auth の UUID)と `accessRole`(`ADMIN` / `STAFF`)を追加し、店長・経理・オーナーも `Staff` の 1 レコードとして管理する(職種 `role = MANAGER`)。別の `AdminUser` テーブルは作らない(Staff の二重管理禁止に準拠)
- **代替案**: 経理・オーナーがシフトに載らない場合は `Staff.isActive=false` かつ `accessRole=ADMIN` で運用

### Q4. ステータス系カラムの型

指示書では一部が `enum`(`ShiftStatus` 等)、一部が `String`(`ShiftPeriod.status`、`PayrollRun.status`、`EscalationTicket.status`、`Vendor.paymentTerms` 等)で書かれています。

- **仮定**: **指示書の記法を踏襲**(enum 指定のものは Prisma enum、String のものは String のまま)。値の候補はスキーマの `///` コメントに記載
- **理由**: 後続フェーズで値が増減しやすい項目(`CUSTOM:<days>` のような可変値を含む)を早期に enum 化すると migrate が頻発するため
- **影響**: String カラムのバリデーションはアプリ層(zod)で行う

### Q5. DB カラム命名

- **仮定**: Prisma のフィールド名(camelCase)をそのまま列名にする(`@map` による snake_case 変換なし)。指示書の「`business_date DATE` カラム」は概念上の指定と解釈し、列名は `businessDate`(型は `DATE`)
- **代替案**: Supabase の SQL Editor / RLS を多用するなら snake_case マッピングを全モデルに付与(機械的に変換可能)

### Q6. 2 系統の LINE アカウントの環境変数名

- **仮定**: `LINE_STAFF_CHANNEL_SECRET` / `LINE_STAFF_CHANNEL_ACCESS_TOKEN`、`LINE_ADMIN_CHANNEL_SECRET` / `LINE_ADMIN_CHANNEL_ACCESS_TOKEN`。管理側の通知先は `LINE_ADMIN_NOTIFY_TO`(groupId または userId)

### Q7. Node.js のバージョン

- 指示書は **Node.js 22 LTS**。開発機は Node.js 24.14 だったため `engines.node >= 22` とし、24 で `install / build / test` を検証。Vercel 側は 22.x を指定する想定

---

## A2. AI上司フェーズ1(2026-09-03)— 回答済みの質問と決定事項

2026-09-03 に以下 8 問を確認し、回答に沿って `apps/ai-boss` のフェーズ1を実装した。

| # | 質問 | 決定 | 実装上の反映 |
|---|---|---|---|
| 1 | 「CROSS スタッフ」の Webhook URL はどのアプリが受けるか(Q1 の再確認) | **ai-boss が直接受ける**。`shift:` 宛て postback / follow / accountLink は `SHIFT_PAYROLL_INTERNAL_URL` が設定されていれば shift-payroll の `/api/internal/line-event` へ転送(`x-internal-secret: INTERNAL_API_SECRET`)、未設定ならログのみ | `apps/ai-boss/app/api/line/webhook/route.ts`、`lib/line/handler.ts` の `createShiftForwarder`。Q1 の仮定(shift-payroll 受信)は**撤回**。shift-payroll 実装時に内部 API 受け口を用意する |
| 2 | フェーズ1 の検索方式 | **キーワード(文字バイグラム + IDF)+ Claude リランク**。DB 拡張不要 | `lib/knowledge/retriever.ts`(`KeywordRetriever` → `ClaudeRerankRetriever`)。`KnowledgeRetriever` interface で pgvector 実装に差し替え可 |
| 3 | `Staff.lineUserId` 未紐付けのユーザーからの質問 | **仮 Staff を自動作成して回答**(`isActive=false`、名前は LINE 表示名、`role=FLOOR_VIP`、`employmentType=PART_TIME`、`hourlyWage=0`) | `lib/line/handler.ts` の `resolveStaff`。管理画面「スタッフ(仮登録)」で一覧。本人との紐付けはシフト給与側のスタッフ管理で行う想定 |
| 4 | 外部サービスの認証情報 | **モックで実装し後で接続**。DB / Anthropic / LINE / Supabase Auth のいずれも未設定で一通り動く | `lib/store/memory.ts`(メモリストア + 起動時に knowledge_seed 自動投入)、`packages/ai-client` の `MockAiClient`、line-router のモック送信、開発時の認証スキップ |
| 5 | エスカレーション発生時の店長通知 | **管理画面のキューのみ**(LINE 通知なし)。未回答件数は後続の毎朝 10:00 死活監視レポートに含める | `app/admin/escalations` |
| 6 | 既存マニュアル取込の対応形式 | **PDF / 画像 / Word すべて**。Word は mammoth でテキスト抽出 → Claude で整形 | `lib/import/convert.ts`。原本は Supabase Storage(`knowledge-uploads`)に保存(設定時) |
| 7 | 管理者アカウントの作成方法 | **Supabase Dashboard で手動作成**。管理画面はログイン画面のみ | `lib/admin/auth.ts`。認可は `Staff.authUserId + accessRole=ADMIN` または `ADMIN_EMAILS` |
| 8 | 進め方 | **フェーズ1 を一気に実装** | 本節の全項目 |

### AI上司フェーズ1 で新たに置いた仮定

- **スキーマ追加**(指示書 02 の骨子に無いもの): `KnowledgeDocVersion`(バージョン履歴)、`KnowledgeImport`(取込ジョブ)、`KnowledgeDoc.source`、`KnowledgeChunk.heading`、`EscalationTicket.conversationId / deliveredAt / addedDocId`。`Message.confidence` に `"emergency"` / `"hr_redirect"` を追加(String カラムのため migrate 不要)
- **confidence の分岐**: `high` → 回答 + 根拠。`low` → 回答 + 注意書き + EscalationTicket(店長が確認)。`no_answer` → 定型文 + EscalationTicket。`hr_redirect` → 店長誘導(チケット無し)。Claude API 失敗時も `no_answer` 扱いでチケットを作り、質問を取りこぼさない
- **根拠ドキュメント名**はモデルに書かせず、`cited_doc_ids` からバックエンドが `根拠: 『タイトル』` を付ける(表記を統一し、存在しないドキュメント名の捏造を防ぐ)
- **店長回答の配信**はプッシュ(replyToken は 1 分で失効するため不可避)。失敗時は `Job(kind=LINE_PUSH)` に積み、`/api/cron/jobs`(10 分ごと)で 5 分 → 30 分の指数バックオフ、3 回失敗で FAILED。「管理アカウントへの LINE 通知」は後続フェーズ
- **緊急キーワード**は設定値(`AppSetting: ai-boss.settings`)の `emergencyRules` で管理。初期ルールは救急 / 火災 / 警察・暴力・盗難 / 地震・停電。判定は NFKC 正規化後の部分一致で、会話ログには `confidence="emergency"` として記録
- **プロンプトキャッシュ**: システムプロンプトは日時・スタッフ名を含めず固定にし `cache_control` を付与。ナレッジ抜粋と質問はユーザーメッセージ側
- **モデル**: 共通前提どおり `claude-sonnet-4-6` を既定(`ANTHROPIC_MODEL` で変更可)。構造化出力(`output_config.format` + zod)で JSON を受ける。拡張思考は使わない(応答速度優先)
- **モック AI の判定**は「質問と各抜粋のトークン重なり率 ≥ 0.5 → high、≥ 0.3 → low、それ未満 → no_answer」+ 人事系キーワードの正規表現。ゴールデン QA はモックで 37/37 一致するよう質問文・雛形を調整しているが、**回答の正しさは実 API でしか評価できない**
- **管理画面の認証スキップ**は `NEXT_PUBLIC_SUPABASE_URL` 未設定 かつ `NODE_ENV !== 'production'` のときだけ。本番で未設定なら `/login?error=unconfigured` に留める
- **ファイルアップロード上限** 20MB(`next.config.ts` の `serverActions.bodySizeLimit=25mb`)。Anthropic の PDF 上限(32MB / 600 ページ)より小さく設定
- **ローカル検証(2026-09-03)**: 別セッションが用意した PGlite(`npm run db:local`)を **ポート 54330 / 別データディレクトリ**で起動し、`apps/ai-boss/.env.local`(git 管理外)で `DATABASE_URL` を上書きして PrismaStore を実 DB で検証した(`prisma migrate deploy` → `seed:knowledge` → Webhook 疑似送信 → 管理画面操作)。ルート `.env` の 54329 はシフト給与側の作業用なので触らない。`0001_init` マイグレーションには AI上司の追加モデルも含まれているため、Supabase へは `npm run db:migrate:deploy` だけでよい
- **line-router の冪等性ストア**は `createMany({ skipDuplicates: true })`(ON CONFLICT DO NOTHING)を優先する方式に変更した。PGlite の socket サーバーは一意制約違反エラーの直後に接続を切るため、P2002 を捕捉する方式では再送イベントの処理が 2 回に 1 回 P1017 で失敗した。`createMany` が無いクライアントでは従来の P2002 判定にフォールバックする
- **メッセージの createdAt**: AI の返信は必ず質問より 1ms 以上後の時刻で保存する。同一時刻だと Postgres の `ORDER BY createdAt` が不定になり、履歴の並びが崩れて追い質問の判定を誤った(実 DB 検証で発見・修正、回帰テスト追加)
- **仮スタッフの `hourlyWage=0`** はシフト給与側の給与計算に影響しないよう `isActive=false` と組で扱う(給与計算は `isActive` かつ `WageHistory` 参照が前提)

---

## B. 技術選定の判断(質問ではないが記録)

| 項目 | 判断 | 理由 |
|---|---|---|
| Next.js | **15.5 系**に固定(`^15.5.0`)。最新は 16.x | 16 は Turbopack 既定化・設定項目変更などがあり、指示書執筆時点の App Router 前提と最も互換性が高い 15 系を採用。アップグレードは基盤安定後に別タスクで |
| Prisma | **6.19 系**に固定(`6.19.3`)。最新は 7.x | 7 は `prisma.config.ts` 必須・ドライバーアダプタ必須など破壊的変更が大きい。`postgresqlExtensions`(pgvector)は 6 系で利用可 |
| TypeScript | **5.9 系**(`^5.9.0`)。最新は 7.x(Go 実装) | 7 系はツールチェーン(Next.js の型チェック、Vitest)との互換性が固まっていないため |
| Vitest | **3.2 系** | 4 系は設定 API に変更あり。3 系で十分 |
| 日時ライブラリ | `date-fns` v4 + `date-fns-tz` v3 | 指示書の指定どおり。`Intl` だけでも書けるが明示性を優先 |
| パッケージのモジュール形式 | ESM(`"type": "module"`, tsc → `dist/`) | Next.js 15 / Vitest / Node 22 のいずれも ESM をネイティブに扱える。相対 import は `.js` 拡張子付き(NodeNext) |
| Prisma Client の出力先 | 既定(`node_modules/@prisma/client`) | Next.js の `serverExternalPackages` 既定と相性が良い。ルート `postinstall` で `prisma generate` を実行し、`npm install` 直後から型が揃うようにした |
| `@line/bot-sdk` | **line-router では依存しない** | 署名検証は `node:crypto` で十分。Webhook イベント型は必要最小限の構造型を自前定義し、SDK のメジャーバージョン変更に巻き込まれないようにした。Flex Message 等で SDK が必要になったらアプリ側で追加 |
| Lint / Formatter | **未導入** | 今回のスコープ外。導入する場合は ESLint(flat config)+ Prettier をルートに置き、`turbo run lint` を追加 |
| Git | `git init` のみ実施(コミットなし) | Turborepo のハッシュ計算・`.gitignore` の有効化のため。初回コミットは利用者側で |

---

## C. 各パッケージの仕様上の仮定

### packages/business-date

- 営業日 = `(timestamp − 10h)` を **Asia/Tokyo** で日付化。サーバーの `TZ` には依存しない(テストで `TZ` を UTC / LA / Auckland に変えて同一結果を検証)
- `getBusinessDateRange(d)` は **[d 10:00 JST, d+1 10:00 JST)**(始点含む・終点含まない)
- Prisma `@db.Date` へは **UTC 深夜 0 時の Date** を渡す規約(`businessDateToDbValue`)。Prisma が UTC 日付部分を DATE として保存するため
- `businessDateTimeToDate(d, "HH:mm")` は 10:00〜23:59 を当日、00:00〜09:59 を翌暦日として解釈(シフト予定 20:00〜翌 5:00 の組み立て用)

### packages/line-router

- **冪等性の方式**: 処理開始前に `webhookEventId` を予約(claim)し、ハンドラが失敗したら予約を解除して **HTTP 500** を返す。LINE 側の再送(要: コンソールで「エラーの再送」ON)で再処理される。成功済みイベントは再送されてもスキップ
  - 1 リクエストに複数イベントが含まれ一部だけ失敗した場合、成功分は予約が残るため再送時に二重処理されない
- **振分けルール**(スタッフアカウント):
  - `postback.data` が `shift:` → シフト、`ai:` → AI上司、それ以外のプレフィックス → 無視(`onIgnored`)
  - `message`(テキスト・画像・スタンプ等すべて)→ AI上司
  - `follow` / `unfollow` → 両方(Q2)
  - `accountLink` → シフト
  - `join` / `leave` / `memberJoined` / `beacon` / `unsend` 等 → 無視
  - LIFF からの操作は Webhook を経由しない(各アプリの API を直接呼ぶ)ため対象外
- `postback.data` の形式は `<ns>:<action>?k=v&...`(URLSearchParams でエンコード、300 文字上限を事前検証)
- **署名検証のスキップ**は「チャネルシークレット未設定 **かつ** `NODE_ENV !== 'production'`」のときだけ。本番で未設定なら起動時に例外
- 送信クライアントはアクセストークン未設定時に **モック**(メモリ記録 + ログ)へフォールバック。`replyMessage` を優先し `pushMessage` は最小限、という運用方針はアプリ側で守る
- 「CROSS 管理」アカウント(請求書)の Webhook は別チャネルなので、この振分けルールは適用せず `apps/invoice` 側で独自にハンドラを組む(署名検証・冪等性ストアは共通利用)

### packages/shared-db

- 指示書 01〜03 のモデルを統合し、`Staff` は 1 つだけ。相互参照には `@relation` と `onDelete` を付与(スタッフ削除で勤怠等は Cascade、給与明細は Restrict)
- 指示書に無い共通テーブルを追加(共通前提書「信頼性要件」に対応):
  - `ProcessedWebhookEvent`: webhookEventId 冪等性
  - `Job`: 失敗キュー(PENDING / PROCESSING / FAILED / DONE、attempts、maxAttempts=3、lastError、runAfter)
  - `AppSetting`: 管理画面から変更可能な設定値(時給・必要人員テンプレ・丸め・締め日など。ハードコード禁止)
  - `AuditLog`: 承認・支払記録・修正の監査ログ
- 指示書に無いが必要と判断して追加したカラム: `Staff.authUserId` / `accessRole` / `updatedAt`、`TimeRecord.clockInLocation` / `clockOutLocation`(打刻位置情報)、`InvoiceIntake.unknownSender` / `hasAttachment` / `lastError`、`Invoice.approvedAt`、`Conversation.lastMessageAt` / `closedAt`(30 分セッション判定)、`PayrollRun.finalizedAt` / `finalizedBy`
- `KnowledgeChunk.embedding` は `Unsupported("vector(1024)")?`。Prisma Client からは読み書きせず raw SQL で扱う。フェーズ1(全文検索)では null のまま
- Supabase 接続は `DATABASE_URL`(Transaction pooler 6543)+ `DIRECT_URL`(5432、migrate 用)の 2 本
- `DATABASE_URL` 未設定時は Prisma Client をインスタンス化せず、`pingDatabase()` は `skipped` を返す(実 DB なしで `dev` / `test` / `/api/health` が通る)

### apps/*

- ポート: shift-payroll `3001` / ai-boss `3002` / invoice `3003`
- `/api/health` は DB 未設定なら `200 {"db":{"status":"skipped"}}`、DB 設定済みで疎通失敗なら `503 {"status":"degraded"}`。毎朝 10:00 の死活監視レポート(共通前提)はこのエンドポイントを土台に後続フェーズで実装
- 環境変数はモノレポルートの `.env` を `next.config.ts` で読み込む。アプリ直下の `.env.local` があればそちらが優先
- Anthropic API クライアントの抽象化(インターフェース + モック)は 2026-09-03 に `packages/ai-client`(`@sakura-cross/ai-client`)として追加済み(AI上司フェーズ1)。請求書管理もこれを使う

---

## D. 未実装で後続フェーズに送ったもの(基盤スコープ外)

- 各アプリの LINE Webhook ルート(`/api/line/webhook`)と LIFF ページ
- 管理画面の認証ミドルウェア(Supabase Auth)
- `Job` テーブルを処理する cron(指数バックオフ、3 回失敗で管理アカウント通知)
- 毎朝 10:00 の死活監視レポート送信
- Anthropic クライアント抽象化・モック
- `vercel.json`(cron 定義)、ESLint / Prettier、CI 設定
- Prisma の初回マイグレーションファイル(`migrations/` は Supabase 接続後に `npm run db:migrate -- --name init` で生成)

---

## E. シフト給与(指示書 01 フェーズ1)— 2026-09-03 に確認済みの決定事項

質問15項目はすべて回答済み(いずれも推奨案を採用)。以下は確定仕様として実装する。

| # | 決定 |
|---|---|
| 1 | ローカル開発時、`NODE_ENV!=production` かつ Supabase 未設定なら管理画面は開発用ログインバイパス(admin 固定)。本番では無効 |
| 2 | 排他制御の競合テストは二段構え: フェイクリポジトリの単体テスト(常時)+ `TEST_DATABASE_URL` 設定時のみ実 DB 統合テスト |
| 3 | Vercel Pro 前提。欠員募集は発行時に同期で即時送信、cron(毎分)は失敗再試行のみ |
| 4 | 給与締め日の既定は月末締め(1日〜末日)。設定で変更可 |
| 5 | 週上限(既定 40h)は月〜日・営業日基準・雇用形態問わず一律。上限値と開始曜日は設定値 |
| 6 | ベテラン = 入店3ヶ月以上(`hiredAt` 空もベテラン扱い)。職種不問、同一営業日で時間帯が重なればよい |
| 7 | 早番 = 20:00〜翌1:00 に収まるスロット、遅番 = 翌0:00 以降開始のスロット。境界は設定値 |
| 8 | 欠員募集の確定方式の既定は先着順(条件付き UPDATE + version)。設定で店長承認に切替可 |
| 9 | 月給制社員(`FULL_TIME` かつ `monthlySalary` あり)は固定額のみ計上、深夜割増なし。月給が空の FULL_TIME は時給者として計算 |
| 10 | 金額の円未満は日別に切り捨て。設定で月合計切り捨て/日別四捨五入に変更可 |
| 11 | CSV は UTF-8 BOM 付き。設定で Shift_JIS に切替可 |
| 12 | 職種適合 = `Staff.role` 一致、または `skills` に該当職種キー(小文字)が true |
| 13 | 日払い登録フォームは勤怠画面に実装。インセンティブは計算ロジックと DB のみ(入力画面はフェーズ2) |
| 14 | 確定シフトはスタッフごとに本人分を1通プッシュ。再確定時は差分のある人にのみ再通知 |
| 15 | 管理画面は追加 UI 依存なし(素の React + CSS、ドラッグは HTML5 ネイティブ DnD) |

### 補足の実装判断(質問には含めなかったもの)

- **打刻の丸め方向**: 指示書の「出勤は切り捨てず、退勤は切り上げない」は文言どおりだと労働者不利になるため、労基法上の安全側(出勤は早い方へ、退勤は遅い方へ丸める = `favor_worker`)を既定とした。`nearest`(最近接)/ `strict`(出勤を遅く・退勤を早く)も設定で選べる。既定の丸め単位は 0(丸めなし)
- **休憩の控除元**: 休憩分数は通常時間帯から先に控除し、足りない分だけ深夜時間帯から控除する(深夜割増を削らない安全側)
- **深夜時間帯**: 営業日 D の深夜窓は [D 22:00, D+1 05:00) JST の1つのみ。営業日開始(10:00)前の時間帯は前営業日に属するため二重計上しない
- **基本給と割増の分離**: `basePay` は全労働分数 × 時給、`nightPremiumPay` は深夜分数 × 時給 × 0.25(割増分のみ)。`grossPay = basePay + nightPremiumPay + incentivePay`、`netPay = grossPay − advanceDeduction`
- **優先度スコア**: `score = (FULL_TIME ? 8h : 0) − 今期割当時間`。社員優先だが、既に8時間以上多く入っている社員よりアルバイトを優先する(公平性との両立)
- **新人制約の2パス処理**: 1パス目でベテランを含む割当を行い、ベテランが同席するようになったスロットへ2パス目で新人を割り当てる
- **LIFF 認証**: LIFF の ID トークンを `https://api.line.me/oauth2/v2.1/verify` で検証(`LINE_STAFF_LIFF_CHANNEL_ID` が必要)。未設定かつ非本番では `x-dev-line-user-id` ヘッダ / `?dev_user=` で開発用ユーザーを指定できる
- **AI 上司への転送**: スタッフ用 Webhook は shift-payroll が受け、`ai` 宛てイベントは `AI_BOSS_INTERNAL_URL` + `INTERNAL_API_SECRET` で ai-boss へ転送。未設定時はログのみ

### 実装中に追加した判断(2026-09-03)

- **ローカル DB は PGlite**(`npm run db:local`)。開発機に Docker も Postgres も無かったため、WASM 版 Postgres を TCP で公開して Prisma から通常どおり接続する。データは `.pglite/` に永続化。本番は Supabase
- **Prisma のエンジンは binary 方式**(`.env` の `PRISMA_CLIENT_ENGINE_TYPE=binary`)。開発機が Windows ARM64 で、既定の library 方式(x64 の `.node`)を読み込めなかったため。x64 の Linux(Vercel)では未設定で既定のままでよい。`generate` スクリプトは `dotenv -e ../../.env` 経由で実行するので `.env` の値が反映される
- **LIFF は 1 アプリ運用を推奨**: `LINE_STAFF_LIFF_ID_PREFERENCE` を全ページ共通の LIFF ID として使い、リッチメニューの 4 ボタンはそれぞれ `/liff/preference` `/liff/schedule` `/liff/timeclock` `/liff/payslip` へのディープリンクにする(個別に ID を分ける運用も可)
- **希望提出の締切後**: 確定前であれば締切後も提出を受け付け、`late=true` を返して画面に注意を表示する(締切で締め出すと店長への個別連絡が増えるため)
- **確定済み割当の削除**: 履歴を残すため `CANCELLED` に変更し、再確定時に「取消」として本人へ差分通知する。下書きは物理削除
- **打刻修正の承認**: 承認時に `TimeRecord` を上書きし `approved=true` にする(承認行為をもって承認済み扱い)
- **未登録ユーザーの Postback**: 応募時に `Staff` が無ければ「登録が完了していない」旨を返信する
