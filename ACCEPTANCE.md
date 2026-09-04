# ACCEPTANCE — シフト調整・給与計算ツール(指示書 01 フェーズ1)

検証日: 2026-09-03 / 環境: Windows 11 ARM64, Node 24, PGlite(ローカル Postgres), LINE 未接続(モック送信)

凡例: ✅ 自動テストで担保 / 🖱️ 手動確認済み / ⏳ LINE 実接続後に確認が必要(手順のみ記載)

実行コマンド:

```bash
npm run test --workspace=@sakura-cross/shift-payroll
```

結果: 5 ファイル 73 テスト成功(`test/payroll.test.ts` 37 / `test/scheduling.test.ts` 26 / `test/open-shift.test.ts` 8 / `test/open-shift.integration.test.ts` 1 / `test/health.test.ts` 1)

---

## 受け入れ基準(指示書 01 §8)

### 1. スタッフが LINE だけで「希望提出 → 確定確認 → 打刻 → 明細確認」を完結できる

- [x] 🖱️ **LIFF 画面 4 種を実装し、開発モード(LIFF 未設定)で一連の操作を確認**
  - `/liff/preference`(希望提出: 期間選択 → 日ごとに ○×早遅 → 送信 → `ShiftPreference` upsert)
  - `/liff/schedule`(確定シフト一覧)
  - `/liff/timeclock`(出勤・退勤ボタン、位置情報は取れれば記録、修正申請フォーム)
  - `/liff/payslip`(確定済み明細の内訳)
  - `/liff/register`(初回登録 → 管理画面で承認 → `Staff.lineUserId` 紐付け)
- [ ] ⏳ **LINE 実機**: LINE Developers で LIFF を作成し `.env` に `LINE_STAFF_LIFF_ID_*` と `LINE_STAFF_LIFF_CHANNEL_ID` を設定 → リッチメニューに 4 つの LIFF URL を設定 → 実機で友だち追加 → 登録 → 各画面を操作。ID トークン検証は `lib/liff/auth.ts`

- [x] 🖱️ **E2E(2026-09-03 実施)**: LIFF 開発モードで希望提出(PUT 3 日分 saved=3)→ 管理画面で 9/16〜9/30 を自動生成(57 件割当 / 45 名不足を赤表示)→「確定して LINE 配信」→ 新規確定 57 件・LINE 連携済み 2 名へ配信(送信ログ SHIFT_CONFIRMED)→ LIFF のシフト確認 API に本人分が表示 → 打刻 API で出勤・退勤(重複出勤は 400)→ 給与確定後に LIFF 明細 API へ反映

**手動確認手順(開発モード)**

1. `npm run db:local` / `npm run dev` を起動し http://localhost:3001/liff/preference?dev_user=Udev-staff を開く(渡辺 花として操作)
2. 期間を選び、日付ごとに ○/×/早/遅 を押して「希望を送信する」→ 管理画面 `/admin/periods/<id>` の希望一覧に反映されることを確認
3. `/liff/timeclock` で「出勤」→ `/admin/attendance?date=<今日の営業日>` に打刻が表示される → 「退勤」
4. 管理画面で給与計算を確定後、`/liff/payslip` に明細が表示される

### 2. 20:00〜翌4:00 の勤務 1 件で、深夜割増が正しく 6 時間分計算される

- [x] ✅ `payroll.test.ts › 受け入れ基準: 20:00〜翌4:00 の勤務で深夜割増が 6 時間分`
  - 自動休憩なし: 労働 480 分 / 深夜 360 分 / 割増 = 1,300 × 6 × 0.25 = 1,950 円
  - 自動休憩あり(8h → 45 分): 休憩は通常時間帯から控除され深夜 360 分は維持
  - `computePayroll` 経由で 基本給 10,400 + 割増 1,950 = 総支給 12,350 円
- 関連: `深夜時間帯の判定(日またぎ)`(18:00〜23:00 → 60 分、翌 4:00〜9:00 → 60 分、22:00〜翌5:00 → 420 分)

### 3. 当日欠勤登録から 60 秒以内に、条件合致スタッフへ募集がプッシュ配信される

- [x] 🖱️ **同期送信を確認**: `/admin/periods/<id>` の確定チップ「欠勤」→ `markAbsentAction` → `issueOpenShift()` が同一リクエスト内で対象者を抽出し `enqueueLinePush(sendNow=true)` で即時送信(cron を待たない)。LINE 未接続時はモッククライアントが即時に `DONE` を記録し、`/admin/notifications` に `OPEN_SHIFT` として表示される
- 対象者の抽出条件(`lib/open-shift/service.ts issueOpenShift`): 職種適合(role 一致 or skills)/ その日に DRAFT・CONFIRMED の割当なし / 希望が × でない / 在籍中 / 未成年は深夜スロット除外 / LINE 連携済み
- [ ] ⏳ **LINE 実機**: 実トークン設定後、欠勤登録から Flex Message(日付 / 時間 / 職種 / 応募ボタン)が 60 秒以内に届くことをストップウォッチで確認。失敗時は cron(毎分)が最大 3 回再試行

### 4. 日払い 5,000 円を登録した月の明細で、差引支給が 5,000 円減っている

- [x] ✅ `payroll.test.ts › 受け入れ基準: 日払い 5,000 円の控除`(総支給は不変、`advanceDeduction=5000`、`netPay = grossPay − 5000`。期間外の日払いは控除しない)
- [x] 🖱️ シードデータ(渡辺 花・前月 10 日に 5,000 円)で `/admin/payroll` → 前月期間で「計算する」→ 明細の日払い控除 −¥5,000 と差引支給を確認。勤怠画面 `/admin/attendance` の「日払い・前払い」フォームから追加登録できる

### 5. 月の途中で時給を 1,300 円 → 1,400 円に改定した場合、改定日前は 1,300 円、以降は 1,400 円

- [x] ✅ `payroll.test.ts › 受け入れ基準: 月途中の時給改定は WageHistory を参照`
  - `resolveHourlyWage` が勤務日時点で有効な履歴を返す(1/14 → 1,300、1/15 → 1,400)
  - `Staff.hourlyWage`(キャッシュ)を 9,999 に変えても履歴の値で計算される
  - 履歴が無い場合は `Staff.hourlyWage` を使い警告を出す
- 管理画面 `/admin/staff/<id>` の「時給履歴」から改定を追加(適用開始日指定)。シードでは田中 玲奈が前月 15 日に 1,300 → 1,350 に改定済み

### 6. 9 時間勤務・休憩未入力の打刻に対し、60 分の自動休憩控除が適用され明細に表示される

- [x] ✅ `payroll.test.ts › 受け入れ基準: 9 時間勤務・休憩未入力 → 60 分自動控除`(在店 540 分 → 休憩 60 分 → 労働 480 分、`autoBreakApplied=true`。手入力の休憩があれば自動控除しない。境界 6h/8h のテスト、設定で OFF 可)
- [x] 🖱️ 給与画面 `/admin/payroll/<id>` の日別内訳で休憩列に「自動控除」バッジが表示される。LIFF 明細でも「(自動)」表示

### 7. 欠員募集に 2 ユーザーが同時応募しても、確定は必ず 1 名になる(競合テストで担保)

- [x] 🖱️ **Webhook 経由の E2E**: 開発モードで `shift:apply_open_shift?id=<募集ID>` の Postback を 2 ユーザー分(Udev-staff / Udev-manager)同時に `POST /api/line/webhook` へ送信 → `/admin/open-shifts` で「確定: 渡辺 花」「落選: 高橋 健」を確認。返信は line-router のモッククライアントが記録

- [x] ✅ `open-shift.test.ts › 受け入れ基準: 2 ユーザーが同時応募しても確定は必ず 1 名`(フェイクリポジトリ。2 名同時 → WON 1 / LOST 1。10 名同時 × 100 回で常に勝者 1 名。確定後の応募は CLOSED)
- [x] ✅ `open-shift.integration.test.ts › 5 名が同時に応募しても FILLED は 1 名だけ`(**実 DB**: `TEST_DATABASE_URL` を PGlite に向けて実行。`updateMany where status=OPEN and version=N` の条件付き UPDATE で FILLED 1 / version 1 / 応募 WON 1 LOST 4)
- 実装: `lib/open-shift/apply.ts`(純ロジック)+ `lib/open-shift/prisma-repo.ts`(条件付き UPDATE)。負けた側には「先に決まってしまいました」を返信(`openShiftResultMessage(false)`)

### 8. FINALIZED 済みの期間の勤怠を編集しようとするとブロックされる

- [x] 🖱️ **E2E**: 2026-08 期間を `/admin/payroll` で計算 → 確定(明細 2 名に配信、送信ログに PAYSLIP ジョブ)→ `/admin/attendance?date=2026-08-15` に警告バナー → LIFF の修正申請 API(2026-08-20)が 400「給与確定済みのため修正できません」→ CSV は UTF-8 BOM 付きでダウンロード可

- [x] ✅ `payroll.test.ts › 受け入れ基準: FINALIZED 期間の編集ブロック`(`assertNotLocked` が期間内の営業日で `PayrollLockedError`、境界日も含む。メッセージに「再計算」の案内)
- [x] 🖱️ 管理画面: 確定後に `/admin/attendance?date=<期間内>` を開くと警告バナーが出て入力欄・承認・日払いフォームが無効化。サーバーアクション側でも `guardLock` で拒否。LIFF の打刻・修正申請 API も同じチェックで 400 を返す
- 修正が必要な場合は `/admin/payroll/<id>` の「再計算」で新しいドラフトを作成(確定分は履歴として残る)

---

## 指示書 §5.3 シフト自動生成の担保(ユニットテスト)

`scheduling.test.ts`(26 件)

- 未成年制約: 22:00 以降を含むスロットに入らない / 22:00 前終了なら可 / 境界(22:00 ちょうど終了は可)
- 新人×ベテラン: 新人単独は不足 / 同時間帯にベテランがいれば 2 パス目で割当 / 重ならない時間帯のベテランでは不可 / 既存確定割当のベテランでも可
- 公平性: 今期割当時間が少ない人を優先 / 複数日で均等に分散 / 同点なら社員優先 / 社員が 8h 以上多ければアルバイト優先
- 制約: 希望未提出・× は候補外 / 早番・遅番の時間帯判定 / skills による兼務 / 同日重複禁止 / 週 40h 上限(週の開始曜日は設定、0 = 無制限)
- 充足不能スロット: missing 人数と除外理由の内訳を返す / 候補が少ないスロットを先に処理 / 決定的(同じ入力で同じ出力)

## その他の担保

- 打刻の丸め(favor_worker / nearest / strict、境界値)、月給制社員(固定額のみ・割増なし)、未承認打刻の除外と警告、端数処理 3 方式、給与期間(月末締め / N 日締め)、CSV 出力(列・注記)
- LINE 署名検証・冪等性・振分けは `packages/line-router`(79 件)で担保
- 営業日境界(20:00 / 翌 9:59 / 翌 10:00、TZ 非依存)は `packages/business-date`(33 件)で担保

## LINE 実接続後に確認する項目(チェックリスト)

1. `.env` に `LINE_STAFF_CHANNEL_SECRET` / `LINE_STAFF_CHANNEL_ACCESS_TOKEN` / `LINE_STAFF_LIFF_CHANNEL_ID` / `LINE_STAFF_LIFF_ID_*` を設定
2. LINE Developers で Webhook URL を `https://<公開URL>/api/line/webhook` に設定し「検証」→ 200
3. 友だち追加 → 登録案内が reply で届く → LIFF で氏名登録 → 管理画面で承認 → 承認通知が push で届く
4. シフト期間を確定 → 本人分の一覧が 1 通届く。手修正して再確定 → 変更のあった人だけに再通知
5. 確定チップ「欠勤」→ 条件合致者に Flex Message → 2 台の端末で同時に「応募する」→ 1 名だけ確定、もう 1 名に「先に決まってしまいました」
6. 給与確定 → 明細が push で届く
7. `/api/cron/health-report` を手動実行 → 「CROSS 管理」に日次レポートが届く
