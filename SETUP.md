# SETUP — CROSS ROPPONGI 業務システム群(モノレポ基盤)

ナイトクラブ「CROSS ROPPONGI」向け 3 システム(シフト給与 / AI上司 / 請求書管理)の共通基盤です。
この文書は **ローカル起動 → Supabase セットアップ → Prisma migrate** の順で読めば環境が立ち上がるように書いています。
設計上の判断・仮定は [ASSUMPTIONS.md](./ASSUMPTIONS.md) を参照してください。

## 1. 前提ソフトウェア

| ツール | バージョン | 備考 |
|---|---|---|
| Node.js | 22 LTS 以上(24 で動作確認) | https://nodejs.org/ |
| npm | 10 以上(11 で動作確認) | Node.js に同梱 |
| Git | 任意 | Turborepo のキャッシュ計算に使用(無くても動く) |
| Supabase アカウント | — | https://supabase.com/(ローカル起動だけなら不要) |

Windows / macOS / Linux いずれでも動作します(Windows 11 + Git Bash / PowerShell で検証)。

## 2. リポジトリ構成

```
sakura-cross/
├── apps/
│   ├── shift-payroll/      # システム1: シフト調整・給与計算(Next.js, :3001)
│   ├── ai-boss/            # システム2: AI上司(Next.js, :3002)
│   └── invoice/            # システム3: 請求書AI管理(Next.js, :3003)
├── packages/
│   ├── shared-db/          # 統合 Prisma スキーマ + Prisma Client + Supabase クライアント
│   ├── line-router/        # LINE Webhook 署名検証 / 冪等性 / イベント振分け / 送信クライアント(モック付き)
│   └── business-date/      # 営業日ユーティリティ(20:00〜翌10:00 = 1営業日, Asia/Tokyo 固定)
├── .env.example            # 全アプリ分の環境変数テンプレート(取得方法コメント付き)
├── turbo.json              # Turborepo タスク定義
├── package.json            # npm workspaces ルート
├── SETUP.md                # このファイル
└── ASSUMPTIONS.md          # 仮定・設計判断の記録
```

AI上司(`apps/ai-boss`)はフェーズ1 を実装済み(10 章・[apps/ai-boss/README.md](./apps/ai-boss/README.md))。他のアプリは各指示書のフェーズ1で追加します。

## 3. ローカル起動(Supabase なしで動く)

```bash
# 1. 依存インストール(postinstall で prisma generate も走る)
npm install

# 2. 環境変数テンプレートをコピー(値は空のままでも起動できる)
cp .env.example .env

# 3. ビルド確認(共通パッケージ → 3 アプリの順に Turborepo が実行)
npm run build

# 4. テスト(Vitest。LINE / Anthropic / DB の実キー不要)
npm run test

# 5. 開発サーバー起動(3 アプリ同時 + 共通パッケージの watch ビルド)
npm run dev
```

起動後、別ターミナルでヘルスチェック:

```bash
curl -s http://localhost:3001/api/health
```

```bash
curl -s http://localhost:3002/api/health
```

```bash
curl -s http://localhost:3003/api/health
```

いずれも HTTP 200 で次のような JSON が返れば成功です(`DATABASE_URL` 未設定時は `db.status` が `skipped`)。

```json
{
  "status": "ok",
  "app": "shift-payroll",
  "timestamp": "2026-09-02T03:30:00.000Z",
  "businessDate": "2026-09-02",
  "timezone": "Asia/Tokyo",
  "db": { "status": "skipped" },
  "uptimeSeconds": 12
}
```

`businessDate` は「timestamp − 10 時間の日付」なので、朝 10:00(JST)より前は前日の日付になります。

### 単体アプリだけ起動したい場合

```bash
npm run dev --workspace=@sakura-cross/ai-boss
```

(初回は先に `npm run build --workspace=@sakura-cross/shared-db` 等で共通パッケージをビルドしてください。`npm run dev` ルート実行なら自動で行われます)

### 主要 npm スクリプト(ルート)

| コマンド | 内容 |
|---|---|
| `npm run dev` | 3 アプリ + 共通パッケージ watch を同時起動 |
| `npm run build` | 全パッケージ・全アプリをビルド |
| `npm run test` | 全 Vitest を実行 |
| `npm run typecheck` | 全ワークスペースの型チェック |
| `npm run db:generate` | Prisma Client 再生成(スキーマ変更後) |
| `npm run db:migrate -- --name <名前>` | マイグレーション作成 + ローカル適用(`prisma migrate dev`) |
| `npm run db:migrate:deploy` | 既存マイグレーションを適用(本番・CI 用) |
| `npm run db:push` | マイグレーションを作らずスキーマを直接同期(検証用) |
| `npm run db:studio` | Prisma Studio(GUI)を開く |
| `npm run clean` | ビルド成果物削除 |

## 4. Supabase セットアップ

3 システムで **1 つの Supabase プロジェクトを共有** します(テーブルはプレフィックスなしで共存、`Staff` は共用)。

### 4.1 プロジェクト作成

1. https://supabase.com/dashboard → **New project**
2. Region は **Northeast Asia (Tokyo)** を選択
3. Database password を控える(後で接続文字列に埋める)

### 4.2 拡張機能(pgvector)の有効化 — migrate の前に必須

AI上司のベクトル検索用に `vector` 拡張を使います。スキーマに `extensions = [vector]` を宣言しているため、**マイグレーション前に有効化** してください。

- Dashboard → **Database** → **Extensions** → `vector` を検索して **Enable**
- または SQL Editor で:

```sql
create extension if not exists vector with schema extensions;
```

### 4.3 接続文字列の取得

Dashboard → **Project Settings** → **Database** → **Connection string**

| 環境変数 | 使うモード | 用途 |
|---|---|---|
| `DATABASE_URL` | **Transaction**(ポート 6543) | アプリからの接続(Vercel などサーバーレス向け)。末尾に `?pgbouncer=true&connection_limit=1` を付ける |
| `DIRECT_URL` | **Session**(ポート 5432)または Direct | `prisma migrate` 用。pgbouncer 経由では DDL が失敗するため必須 |

`.env` の例:

```dotenv
DATABASE_URL="postgresql://postgres.xxxx:[PASSWORD]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.xxxx:[PASSWORD]@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"
```

### 4.4 API キーの取得

Dashboard → **Project Settings** → **API**

| 環境変数 | 値 | 公開可否 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | 公開可 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` `public` キー | 公開可(RLS 前提) |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` キー | **サーバー専用。絶対に公開しない** |

### 4.5 Auth(管理画面ログイン)

- Dashboard → **Authentication** → **Providers** → **Email** を有効化(メール + パスワード)
- 初期の管理者ユーザーは **Authentication** → **Users** → **Add user** で作成し、後続フェーズで `Staff.authUserId` に紐付けます(ロールは `Staff.accessRole = ADMIN`)

### 4.6 Storage(請求書原本・ナレッジ取込ファイル)

Dashboard → **Storage** → **New bucket** で以下を **Private** で作成:

- `invoices`(`.env` の `SUPABASE_STORAGE_BUCKET_INVOICES`)
- `knowledge-uploads`(`SUPABASE_STORAGE_BUCKET_KNOWLEDGE`)

### 4.7 日次バックアップの有効化(必須)

Dashboard → **Project Settings** → **Database** → **Backups** で日次バックアップが有効になっていることを確認してください(Pro プラン以上で自動。Free プランの場合はアップグレード、または `pg_dump` の定期実行を別途用意)。
給与・請求書データを扱うため、**バックアップ無しでの本番運用は不可** とします。

## 5. Prisma migrate の手順

統合スキーマは [`packages/shared-db/prisma/schema.prisma`](./packages/shared-db/prisma/schema.prisma) にあります。
Prisma CLI はモノレポルートの `.env` を `dotenv-cli` 経由で読みます(`DATABASE_URL` と `DIRECT_URL` の両方が必要)。

### 5.1 初回(空の DB に全テーブルを作成)

```bash
npm run db:migrate -- --name init
```

- `packages/shared-db/prisma/migrations/<timestamp>_init/migration.sql` が生成され、DB に適用されます
- 生成された SQL に `CREATE EXTENSION IF NOT EXISTS "vector"` が含まれます(4.2 で有効化済みなら no-op)
- 完了後 Prisma Client が自動再生成されます

### 5.2 スキーマ変更時(開発)

1. `schema.prisma` を編集
2. `npm run db:migrate -- --name <変更内容>` を実行
3. `npm run db:generate`(migrate dev が自動で行うが、失敗時は手動で)
4. 共通パッケージを再ビルド: `npm run build --workspace=@sakura-cross/shared-db`(`npm run dev` 中なら watch が拾う)

### 5.3 本番・ステージングへの適用

```bash
npm run db:migrate:deploy
```

`migrate deploy` はマイグレーションファイルを順に適用するだけで、スキーマの差分生成や対話は行いません(CI / Vercel のビルドフックから実行することを想定)。

### 5.4 状態確認・GUI

```bash
npm run migrate:status --workspace=@sakura-cross/shared-db
```

```bash
npm run db:studio
```

### 5.5 注意事項

- `KnowledgeChunk.embedding` は `Unsupported("vector(1024)")` 型のため、Prisma Client から直接読み書きできません。埋め込みの保存・検索は `$queryRaw` / `$executeRaw` で行います(AI上司フェーズ2で実装)
- `@db.Date` カラム(`businessDate` 等)には **UTC 深夜 0 時の Date** を渡してください。`@sakura-cross/business-date` の `businessDateToDbValue()` / `toBusinessDateDbValue()` を使えば安全です
- Transaction pooler(6543)経由で `migrate` を実行すると `prepared statement` 系のエラーになります。必ず `DIRECT_URL` を設定してください

## 6. LINE 公式アカウントの設定(概要)

機能実装は後続フェーズですが、アカウント構成は先に確定しておきます(共通前提書に準拠)。

| アカウント | 環境変数プレフィックス | Webhook URL(予定) | 載せる機能 |
|---|---|---|---|
| ①「CROSS スタッフ」 | `LINE_STAFF_*` | `https://<ai-boss>/api/line/webhook`(2026-09-03 変更。10.3 参照) | シフト・打刻・明細(LIFF)+ AI上司(フリーテキスト) |
| ②「CROSS 管理」 | `LINE_ADMIN_*` | `https://<invoice>/api/line/webhook` | 請求書取込・支払指示 + 運用アラート |

1. https://developers.line.biz/console/ でプロバイダーを作成し、Messaging API チャネルを **2 つ** 作成
2. 各チャネルの「チャネル基本設定」→ チャネルシークレット、「Messaging API設定」→ チャネルアクセストークン(長期)を `.env` に設定
3. Webhook URL を設定し「Webhookの利用」を ON、**「エラーの再送」(redelivery)も ON** にする(冪等性チェックが再送を前提にしているため)
4. 「応答メッセージ」「あいさつメッセージ」の自動返信は OFF(Bot 側で制御)
5. ①のチャネルで LIFF アプリを 4 つ(希望提出 / シフト確認 / 打刻 / 給与明細)追加し、LIFF ID を `.env` に設定
6. ①は月 200 通の無料枠を超えるため **コミュニケーションプラン以上** を契約

ローカルで Webhook を受けるには ngrok 等のトンネルを使い、`x-line-signature` 検証のためチャネルシークレットを設定してください。
シークレット未設定時は **開発モードに限り** 署名検証をスキップして受け付けます(本番 `NODE_ENV=production` では起動時にエラー)。

## 7. テスト

```bash
npm run test
```

| パッケージ | 内容 |
|---|---|
| `packages/business-date` | 営業日境界(20:00 / 翌 9:59 / 翌 10:00)、年末年始・閏年、TZ を変えても結果が同一、`@db.Date` 変換 |
| `packages/line-router` | 署名検証、webhookEventId 冪等性(メモリ / Prisma 風ストア)、`shift:` / `ai:` 振分け、ハンドラ失敗時の再送復帰、送信クライアントのモック/実装 |
| `packages/shared-db` | DB / Supabase 未設定時のフォールバック |
| `apps/*` | `/api/health` が DB 未設定で 200 を返す |

個別に実行する場合:

```bash
npm run test --workspace=@sakura-cross/business-date
```

## 8. トラブルシューティング

| 症状 | 対処 |
|---|---|
| `@prisma/client did not initialize yet` | `npm run db:generate` を実行(postinstall で通常は自動) |
| `Environment variable not found: DATABASE_URL` が migrate 時に出る | ルートに `.env` があるか、`DATABASE_URL` と `DIRECT_URL` の両方が入っているか確認 |
| `prepared statement "s0" already exists` | `DIRECT_URL` が pooler(6543)を指している。5432 に変更 |
| `type "vector" does not exist` | 4.2 の pgvector 拡張を有効化してから再実行 |
| `EADDRINUSE :3001` | 別プロセスがポート使用中。`apps/<app>/package.json` の `-p` を変更するか該当プロセスを停止 |
| Windows で `ENAMETOOLONG` / パス長エラー | リポジトリを浅い階層(例 `C:\dev\sakura-cross`)に置く |
| `npm run dev` で共通パッケージの変更が反映されない | 各 `packages/*` の `dev`(tsc --watch)が起動しているか確認。手動なら `npm run build --workspace=@sakura-cross/<pkg>` |

## 9. 本番デプロイ(Vercel)の概要

- Vercel で **3 つのプロジェクト** を作成し、Root Directory をそれぞれ `apps/shift-payroll` / `apps/ai-boss` / `apps/invoice` に設定(Turborepo は自動検出される)
- Environment Variables に `.env.example` の全キーを登録(`NODE_ENV=production`。LINE シークレット未設定だと起動時エラーになる)
- Build Command は既定(`npm run build`)で可。`postinstall` により Prisma Client が生成される
- DB マイグレーションはデプロイ前に `npm run db:migrate:deploy` を CI から実行する
- cron(死活監視 10:00、週次ダイジェスト、期日アラート等)は各アプリの `vercel.json` に定義(後続フェーズ)。`CRON_SECRET` を設定しておく

## 10. AI上司(apps/ai-boss)フェーズ1 のセットアップ

詳細は [apps/ai-boss/README.md](./apps/ai-boss/README.md) を参照。ここでは共通基盤との接点だけまとめます。

### 10.1 実キーなしで触る

```bash
npm run dev --workspace=@sakura-cross/ai-boss
```

http://localhost:3002/admin で管理画面(認証スキップ)。`knowledge_seed/` の 10 カテゴリ雛形がメモリストアに自動投入されます。Webhook は README の curl 例で疑似送信できます。

### 10.2 Supabase 接続後にやること

```bash
npm run db:migrate -- --name ai_boss_phase1
npm run seed:knowledge
```

- Storage に非公開バケット `knowledge-uploads` を作成(4.6 参照)
- Authentication → Users で管理者(店長・オーナー)をメール + パスワードで作成し、`.env` の `ADMIN_EMAILS` にメールを追加(または `Staff.authUserId` にユーザー ID を入れて `accessRole = ADMIN`)

### 10.3 LINE「CROSS スタッフ」の Webhook URL

**`https://<ai-boss のドメイン>/api/line/webhook`** に設定します(6 章の表の「shift-payroll が受ける」は 2026-09-03 に変更。ASSUMPTIONS.md A2 参照)。`shift:` 宛てイベントは `SHIFT_PAYROLL_INTERNAL_URL` を設定すると shift-payroll に転送されます。

### 10.4 Vercel

- Root Directory `apps/ai-boss`。`vercel.json` の cron(`/api/cron/jobs`、10 分ごと)が有効になるよう `CRON_SECRET` を設定
- Webhook ルートは `maxDuration = 60` を指定しています(回答生成に十数秒かかるため)。Hobby プランの上限(10 秒)では足りないので Pro 以上を想定

### 10.5 評価

```bash
npm run eval:ai-boss
```

`ANTHROPIC_API_KEY` があれば実 API で、無ければモックで `eval/golden_qa.json`(37 問)を実行し、一致率(合格ライン 90%)を出力します。プロンプト・ナレッジ構成を変更したら必ず実行してください。

## 11. シフト・給与(apps/shift-payroll)フェーズ1 のセットアップ

### 11.1 ローカル DB(Supabase 不要): PGlite

Docker や Postgres を入れずに動く WASM 版 Postgres を同梱しています(pgvector 込み。本番は Supabase)。

```bash
npm run db:local
```

起動すると `postgresql://postgres:postgres@127.0.0.1:54329/postgres` で待ち受け、データは `.pglite/` に永続化されます。`.env` に次を設定してください。

```dotenv
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres?connection_limit=1
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres?connection_limit=1
# Windows ARM64 のみ必須(x64 の query engine を読み込めないため別プロセス方式にする)
PRISMA_CLIENT_ENGINE_TYPE=binary
```

続けて別ターミナルで:

```bash
npm run db:migrate:deploy
```

```bash
npm run db:seed
```

シード内容: 設定値 / スタッフ 10 名(社員 2・未成年 1・新人 2、時給改定 1 名)/ 必要人員テンプレート / 当月+翌月の営業日と必要人員 / 半月のシフト期間 2 つと希望 / 前月の勤怠 72 件・日払い 5,000 円・インセンティブ。何度実行しても同じ結果になります。

DB を作り直す場合:

```bash
echo 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' | npx dotenv -e .env -- prisma db execute --stdin --schema packages/shared-db/prisma/schema.prisma
```

### 11.2 管理画面(店長・経理)

`npm run dev` 後に http://localhost:3001/admin を開きます。Supabase 未設定のローカルでは **開発用ログインバイパス**(管理者固定)で入れます。本番では Supabase Auth のメール + パスワードが必須で、`Staff.authUserId` または `ADMIN_EMAILS` で権限判定します。

| 画面 | 用途 |
|---|---|
| `/admin` | ダッシュボード(承認待ち・募集中・送信キュー・本日のシフト) |
| `/admin/calendar` | 営業日・イベント種別・動員予測、必要人員(テンプレート展開・個別追加) |
| `/admin/periods` | シフト期間の作成 → 自動生成 → 日×職種グリッドで手修正(ドラッグ)→ 確定 → LINE 配信。不足セルは赤、「募集をかける」で欠員募集、確定チップの「欠勤」で当日欠勤+募集 |
| `/admin/open-shifts` | 欠員募集の状況、店長承認方式の確定、募集の締め切り |
| `/admin/attendance` | 営業日ごとの打刻一覧(予定との乖離を黄色表示)、打刻編集・承認・月次一括承認、日払い登録、修正申請の承認 |
| `/admin/payroll` | 期間を指定して計算 → ドラフト確認 → 確定(明細 LINE 配信)→ CSV。確定後は期間内の勤怠・日払いが編集不可 |
| `/admin/staff` | スタッフ・時給履歴・LINE 登録の承認 |
| `/admin/templates` | イベント種別ごとの必要人員テンプレート |
| `/admin/settings` | 時給・締め日・丸め・休憩・深夜割増・週上限・募集方式など(ハードコードなし) |
| `/admin/notifications` | LINE 送信ログ(キュー・再試行) |

### 11.3 LIFF(スタッフ)

LIFF 未設定のローカルでは **開発モード** になり、URL に `?dev_user=<LINE ユーザー ID>` を付けるとそのユーザーとして操作できます(シード: `Udev-staff` = 渡辺 花、`Udev-manager` = 高橋 健)。

- http://localhost:3001/liff/preference?dev_user=Udev-staff — 希望提出
- http://localhost:3001/liff/schedule — 確定シフト
- http://localhost:3001/liff/timeclock — 打刻・修正申請
- http://localhost:3001/liff/payslip — 給与明細
- http://localhost:3001/liff/register?dev_user=Unew-user — 初回登録(承認待ちになる)

本番では LINE Developers で LIFF アプリを作成し、`.env` に `LINE_STAFF_LIFF_ID_PREFERENCE`(全ページ共通で可)と `LINE_STAFF_LIFF_CHANNEL_ID`(ID トークン検証用)を設定。リッチメニューの 4 ボタンにそれぞれ `https://liff.line.me/<LIFF ID>/preference` のようなディープリンクを設定します。

### 11.4 LINE Webhook・プッシュ・cron

- Webhook: `POST /api/line/webhook`(スタッフ用アカウント)。`shift:` Postback(欠員募集の応募)と follow を処理し、`ai:` 宛ては `AI_BOSS_INTERNAL_URL` へ転送
- プッシュはすべて `Job` キュー(`/admin/notifications` で確認)。即時送信に失敗すると cron が最大 3 回再試行し、3 回失敗で「CROSS 管理」へ通知
- cron(`apps/shift-payroll/vercel.json`): `/api/cron/dispatch-jobs`(毎分)/ `/api/cron/reminders`(12:00 JST、希望提出リマインド)/ `/api/cron/health-report`(10:00 JST、日次レポート)。ローカルでは `curl http://localhost:3001/api/cron/health-report` で手動実行可(`CRON_SECRET` 未設定時)

### 11.5 テストと受け入れ基準

```bash
npm run test --workspace=@sakura-cross/shift-payroll
```

実 DB の競合テスト(`open-shift.integration.test.ts`)は `TEST_DATABASE_URL` 設定時のみ実行されます。受け入れ基準の検証記録は [ACCEPTANCE.md](./ACCEPTANCE.md)。

### 11.5.1 法定控除(社会保険・雇用保険・所得税)の年次メンテナンス

給与計算は健康保険・介護保険・厚生年金・雇用保険・源泉所得税を自動控除します。次の 2 か所を毎年更新してください。

| いつ | 何を | どこで |
| --- | --- | --- |
| 毎年 3 月(協会けんぽの料率改定) | 健康保険料率・介護保険料率(都道府県別、労使合計) | 管理画面 > 設定 > 社会保険・所得税 |
| 毎年 4 月(雇用保険料率改定) | 雇用保険料率(本人負担分) | 同上 |
| 毎年 1 月(源泉徴収税額表の改定) | 電算機計算の特例の月額計算式・標準報酬月額の等級表 | `apps/shift-payroll/lib/payroll/tax-tables.ts` |

スタッフごとの加入状況(社保・雇用保険)、扶養親族等の数、標準報酬月額は **管理画面 > スタッフ > 各スタッフ** で設定します。乙欄で課税対象額が 88,000 円以上のスタッフは「源泉所得税の固定額」に月額表の値を入力してください(自動計算の対象外で、明細に警告が出ます)。

マイグレーション `0002_weekend_and_deductions` を本番に適用する際は、コードのデプロイより先に `npm run db:migrate:deploy` を実行してください(列追加のみで既存コードは動作し続けます)。

### 11.6 トラブルシューティング(シフト給与・ローカル DB)

| 症状 | 対処 |
|---|---|
| `EPERM: operation not permitted, rename ... query-engine-windows.exe` | 開発サーバーが Prisma エンジンを実行中に `prisma generate` が走った。スキーマが変わっていなければ `npm run generate` は自動でスキップされる(stamp 判定)。スキーマ変更後は `npm run dev` を止めてから `npm run db:generate` |
| `/api/health` が `Can't reach database server at 127.0.0.1:54329` だが PGlite は起動している | PGlite のクエリキューが詰まった状態。`npm run db:local` を Ctrl+C で止めて再起動(データは `.pglite/` に残る) |
| `not a valid Win32 application`(query_engine .node) | Windows ARM64。`.env` に `PRISMA_CLIENT_ENGINE_TYPE=binary` を設定し `npm run db:generate` |
| `npm run db:seed` が `Missing script` | ルートで実行する(`packages/shared-db` 配下からは `seed` が見えない) |
