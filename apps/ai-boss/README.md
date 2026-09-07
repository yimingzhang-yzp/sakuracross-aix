# AI上司(apps/ai-boss)— 新人教育・現場 Q&A ボット

指示書 `02_AI上司システム指示書.md` の **フェーズ1(MVP)** 実装です。CROSS ROPPONGI のスタッフが LINE「CROSS スタッフ」で質問すると、店が登録したマニュアル(ナレッジ)を検索し、その内容に基づいて Claude が回答します。根拠が無い質問は推測せず、店長の未回答キューへ回します。

## できること(フェーズ1)

| 機能 | 実装 |
|---|---|
| フリー質問(RAG) | `POST /api/line/webhook` → 検索(`KnowledgeRetriever`)→ Claude(構造化 JSON)→ 根拠ドキュメント名付きで replyToken 返信 |
| マルチターン | 同一スタッフの直近 30 分・最大 10 往復を文脈として渡す。30 分無応答で Conversation を閉じる |
| 応答中表示 | LINE Loading Animation API を呼んでから生成 |
| ログの透明性 | 友だち追加のあいさつ・新しい会話の初回応答に「この会話は記録され、店長が閲覧できます」を必ず付ける |
| エスカレーション | confidence が `no_answer` / `low`、または API 失敗時に `EscalationTicket` を作成。店長が回答すると LINE プッシュで届き(失敗時は Job キューで再試行)、ワンクリックでナレッジに追記 |
| 人事質問の誘導 | 給与額・評価・シフト割当理由は答えず店長へ誘導(`hr_redirect`) |
| 緊急ショートカット | 「救急」「火事」「警察」「地震」等を検知したら API を待たず固定手順 + 責任者連絡先を即時返信。ルールは管理画面で編集 |
| ナレッジ管理 | Markdown エディタ、カテゴリ、有効/ドラフト、バージョン履歴(復元可)、見出し単位・最大 800 字の自動チャンク分割 |
| 既存マニュアル取込 | PDF / 画像は Claude(vision)、Word(.docx)は mammoth でテキスト抽出 → Claude で Markdown 化 → **ドラフト**登録 → 店長がプレビュー・修正して有効化 |
| 会話ログ | 全件閲覧・検索(質問/回答/スタッフ名・期間) |
| チャットテスト | 管理画面 `/admin/chat` で LINE を通さずに Bot の応答を試す(本番と同じ処理経路。会話は「チャットテスト(管理者名)」として記録) |
| 初期ナレッジ | `knowledge_seed/` に 10 カテゴリの雛形(【店舗確認】プレースホルダ付き)。`npm run seed:knowledge` で投入 |
| 評価スクリプト | `npm run eval` — `eval/golden_qa.json`(37 問)の期待挙動との一致率を出力。合格ライン 90% |

フェーズ2 以降(クイズ配信・オンボーディング・進捗ダッシュボード・画像付き質問・FAQ 自動集計・多言語)は未実装です。スキーマ(`TrainingQuiz` / `QuizResult`)だけ用意済み。

## 起動(実キーなしで動く)

```bash
npm install
npm run build --workspace=@sakura-cross/shared-db --workspace=@sakura-cross/line-router --workspace=@sakura-cross/business-date --workspace=@sakura-cross/ai-client
npm run dev --workspace=@sakura-cross/ai-boss
```

http://localhost:3002/admin を開くと管理画面に入れます。`.env` の接続情報が無い場合は次のモックで動きます(画面上部に表示されます)。

| 未設定 | 挙動 |
|---|---|
| `DATABASE_URL` | メモリストア。起動時に `knowledge_seed/` を自動投入。再起動で消える |
| `ANTHROPIC_API_KEY` | モック AI。ナレッジとの語句重なりで回答/エスカレーションを決める(回答本文は該当箇所の抜粋) |
| `LINE_STAFF_CHANNEL_ACCESS_TOKEN` | 送信はログ出力のみ。署名検証もスキップ(開発時のみ) |
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | 管理画面の認証をスキップ(開発時のみ。本番では拒否) |

### LINE を通さずに Webhook を試す

署名未設定の開発モードなら、LINE の Webhook ボディをそのまま POST できます。

```bash
curl -s -X POST http://localhost:3002/api/line/webhook -H "content-type: application/json" -d "{\"destination\":\"U0\",\"events\":[{\"type\":\"message\",\"webhookEventId\":\"e1\",\"timestamp\":0,\"mode\":\"active\",\"source\":{\"type\":\"user\",\"userId\":\"Utest\"},\"replyToken\":\"r1\",\"message\":{\"id\":\"m1\",\"type\":\"text\",\"text\":\"ドリンクチケットは翌日も使えますか\"}}]}"
```

Windows の Git Bash では curl で日本語が化けるため、同梱スクリプトを使うと確実です:

```bash
npm run webhook:send --workspace=@sakura-cross/ai-boss -- "ドリンクチケットは翌日も使えますか?" "Wi-Fiのパスワードは?"
```

返信内容はサーバーログ(`[line-mock] reply`)と、管理画面「会話ログ」で確認できます。

## 実環境への接続

1. **Supabase**: ルート `.env` に `DATABASE_URL` / `DIRECT_URL` / `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` を設定し、`npm run db:migrate:deploy` でマイグレーションを適用(`packages/shared-db/prisma/migrations/0001_init` に AI上司のテーブルも含まれています)。Storage に非公開バケット `knowledge-uploads` を作成
2. **初期ナレッジ**: `npm run seed:knowledge`(店長が編集済みのドキュメントは上書きしません。`-- --overwrite` で強制)
3. **管理者**: Supabase Dashboard → Authentication → Users でメール + パスワードのユーザーを作成し、`ADMIN_EMAILS` にそのメールを入れる(または `Staff.authUserId` を紐付けて `accessRole = ADMIN`)
4. **Anthropic**: `ANTHROPIC_API_KEY`(モデルは `ANTHROPIC_MODEL`、既定 `claude-sonnet-4-6`)
5. **LINE**: 「CROSS スタッフ」チャネルの Webhook URL を `https://<ai-boss のドメイン>/api/line/webhook` に設定(**ai-boss が直接受けます**。ASSUMPTIONS.md Q1)。「エラーの再送」を ON、「応答メッセージ」「あいさつメッセージ」を OFF。`LINE_STAFF_CHANNEL_SECRET` / `LINE_STAFF_CHANNEL_ACCESS_TOKEN` を設定
6. **cron**: `vercel.json` で `/api/cron/jobs` を 10 分ごとに実行(LINE プッシュ失敗の再試行)。`CRON_SECRET` を設定
7. **評価**: `npm run eval` を実 API で実行し、一致率 90% 以上を確認。プロンプト(`lib/chat/prompt.ts`)やナレッジ構成を変えたら必ず再実行する

## コード構成

```
apps/ai-boss/
├── app/
│   ├── api/line/webhook/route.ts   # Webhook 受信(署名検証・冪等性・振分けは packages/line-router)
│   ├── api/cron/jobs/route.ts      # 失敗キュー再試行(LINE_PUSH)
│   ├── login/                      # Supabase Auth ログイン
│   └── admin/                      # 管理画面(Server Components + Server Actions)
│       ├── actions.ts              # すべての更新系操作(requireAdmin → store → 監査ログ)
│       ├── knowledge/              # 一覧 / 新規 / 編集([id]) / 取込(import)
│       ├── escalations/            # 未回答キュー(回答・LINE 配信・ナレッジ追記)
│       ├── conversations/          # 会話ログ一覧・詳細
│       ├── settings/               # 文言・しきい値・緊急ルール
│       └── staff/                  # 仮登録スタッフ一覧
├── lib/
│   ├── chat/answer.ts              # 質問応答オーケストレーション(緊急→セッション→検索→生成→分岐)
│   ├── chat/prompt.ts              # システムプロンプト・JSON スキーマ・履歴の組み立て
│   ├── chat/emergency.ts           # 緊急キーワード固定応答
│   ├── knowledge/retriever.ts      # KnowledgeRetriever(KeywordRetriever + ClaudeRerankRetriever)
│   ├── knowledge/chunker.ts        # 見出し単位・最大 800 字のチャンク分割
│   ├── knowledge/tokenize.ts       # 日本語バイグラムトークナイズ
│   ├── knowledge/seed-loader.ts    # knowledge_seed の読み込み・投入
│   ├── import/convert.ts           # PDF / Word / 画像 → Markdown
│   ├── escalation/deliver.ts       # 店長回答の LINE 配信 + Job 再試行
│   ├── line/handler.ts             # LINE イベント処理(ai 名前空間)+ shift 転送
│   ├── store/                      # 永続化層: types / memory(開発・テスト) / prisma(Supabase)
│   ├── ai/mock-responder.ts        # API キー無し時のモック応答ロジック
│   ├── admin/auth.ts               # 管理画面の認証・認可
│   └── settings.ts                 # 管理画面から変更できる設定値と既定値
├── knowledge_seed/                 # 初期ナレッジ雛形(10 カテゴリ)+ seed.ts
├── eval/                           # golden_qa.json + run-eval.ts
└── test/                           # Vitest(実 DB / 実 API 不要)
```

共通パッケージ: `@sakura-cross/ai-client`(Anthropic 抽象化 + モック。請求書管理でも使う)、`@sakura-cross/line-router`、`@sakura-cross/shared-db`、`@sakura-cross/business-date`。

## 検索方式について

フェーズ1 は DB 拡張(pg_bigm / PGroonga / pgvector)に依存しない **文字バイグラム + IDF** のキーワード検索を採用し、実 API 時は上位候補を Claude でリランクします(`ClaudeRerankRetriever`)。有効チャンクはプロセス内にキャッシュし、ナレッジ保存ごとに更新世代(`AppSetting: ai-boss.knowledge_revision`)を進めて無効化するため、店長がナレッジを更新すると次の質問から反映されます。

pgvector + 埋め込み API(Voyage 等)へ移行する場合は `KnowledgeRetriever` インターフェースを実装して `createRetriever()` を差し替えます。`KnowledgeChunk.embedding`(`vector(1024)`)カラムは用意済みです。

## テスト・評価

```bash
npm run test --workspace=@sakura-cross/ai-boss      # 40 テスト(チャンク分割 / 検索 / 応答分岐 / Webhook / 配信 / 取込)
npm run eval --workspace=@sakura-cross/ai-boss      # ゴールデン QA 37 問。--verbose で応答本文、--json out.json で保存
npm run eval --workspace=@sakura-cross/ai-boss -- --only a01,b02
```

モック実行では「配線」「緊急・人事ルール」「ナレッジ有無の切り分け」の回帰確認しかできません。回答の正しさ(ハルシネーション)は実 API で評価してください。
