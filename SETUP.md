# シフト管理アプリ 構築手順書

これまで作成した各ファイルを、実際に動くアプリに組み上げるための順序です。
上から順に進めてください。

---

## 前提

- Node.js 18 以上
- Supabase アカウント（無料プランでOK）
- Vercel アカウント（デプロイ用・無料プランでOK）

---

## 1. Supabase プロジェクトを作る

1. supabase.com で新規プロジェクトを作成（リージョンは Tokyo 推奨）。
2. プロジェクトの **Settings → API** で次の2つを控える。
   - Project URL（`https://zkjqxtciuxwmixzhvtjj.supabase.co/rest/v1/`）
   - anon public key（または publishable key）(sb_publishable_I-RbXx2OgblsXP0Lztb1YQ_LXJ8m2nX)

## 2. データベースを作る（最重要・最初にやる）

**Settings → SQL Editor** で、次の順に貼り付けて実行する。

1. `supabase/shift_app_schema.sql` … テーブル・型・RLS・トリガー一式
2. `supabase/profiles_admin.sql` … プロフィール管理用のRLS追加＋権限昇格防止トリガー
3. `supabase/promote_owner.sql` … 最初のオーナーを安全に作るための管理関数（手順7で使用）

> 1 → 2 の順序が重要です（1 を先に流してから 2）。3 は 1・2 の後ならいつでも可。
> SQL ファイルはすべて `supabase/` フォルダにあります。

## 3. 認証の設定

Supabase ダッシュボードで：

1. **Authentication → Providers → Email** を有効化。
   - 開発中は「Confirm email」をオフにすると確認メールなしで試せて楽（本番ではオン推奨）。
2. **Authentication → URL Configuration**
   - **Site URL**：開発は `http://localhost:3000`
   - **Redirect URLs** に以下を追加：
     - `http://localhost:3000/auth/callback`
     - （デプロイ後）`https://<本番ドメイン>/auth/callback`
     - （必要なら）Vercel プレビュー用ドメインも
3. （本番のみ）標準メールは送信数制限が厳しいので、**SMTP に Resend 等**を設定。

## 4. Next.js アプリを作る

> **このリポジトリはセットアップ済みです。** `package.json` / `tsconfig.json` /
> `next.config.ts` / `postcss.config.mjs` / `app/globals.css` などの土台ファイルと、
> 各ソースの配置（手順6のツリー）が完了しています。クローン後は
> `npm install` だけで起動できます（手順5の環境変数を設定してから `npm run dev`）。

ゼロから新規に作る場合の参考コマンド：

```bash
npx create-next-app@latest your-app
# 選択: TypeScript = Yes, App Router = Yes, Tailwind CSS = Yes
cd your-app
npm install @supabase/supabase-js @supabase/ssr
```

## 5. 環境変数

プロジェクト直下に `.env.local` を作成：

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=（anon または publishable key）
```

## 6. ファイルを配置する

> **このリポジトリでは配置済みです。** 以下は最終的な構成（「← 元ファイル名」は
> 当初のフラットなファイル名）。ゼロから組む場合の参照用に残しています。

```
your-app/
├─ middleware.ts                      ← middleware.ts
├─ .env.local
├─ public/
│  ├─ sw.js                           ← sw.js
│  ├─ icon-192.png                    ← icon-192.png
│  ├─ icon-512.png                    ← icon-512.png
│  ├─ icon-512-maskable.png           ← icon-512-maskable.png
│  └─ apple-touch-icon.png            ← apple-touch-icon.png
├─ lib/
│  ├─ supabaseClient.ts               ← supabaseClient.ts
│  └─ supabaseServer.ts               ← supabaseServer.ts
├─ components/
│  ├─ AuthScreen.tsx                  ← AuthScreen.tsx
│  ├─ AppNav.tsx                      ← AppNav.tsx
│  ├─ ServiceWorkerRegister.tsx       ← ServiceWorkerRegister.tsx
│  └─ SubmissionReminder.tsx          （新規・希望提出リマインドバナー）
└─ app/
   ├─ layout.tsx                      ← root-layout.tsx
   ├─ page.tsx                        ← page.tsx（ルートの役割振り分け）
   ├─ manifest.ts                     ← manifest.ts
   ├─ globals.css                     （create-next-app が生成・そのまま）
   ├─ login/
   │  └─ page.tsx                     ← login-page.tsx
   ├─ auth/
   │  └─ callback/
   │     └─ route.ts                  ← route.ts
   └─ (app)/
      ├─ layout.tsx                   ← layout.tsx（(app)共通＋リマインド算出）
      ├─ availability/page.tsx        ← ShiftPreferenceCalendar.tsx
      ├─ my-schedule/page.tsx         ← MyScheduleView.tsx
      ├─ schedule/page.tsx            ← OwnerScheduleBuilder.tsx（期間作成・CSV出力を含む）
      └─ employees/page.tsx           ← EmployeeManager.tsx

# ルート直下の設定ファイル（セットアップ済み）
package.json / tsconfig.json / next.config.ts / postcss.config.mjs
.gitignore / .env.local.example

# DB用SQL（Supabase の SQL Editor で実行）
supabase/
├─ shift_app_schema.sql
├─ profiles_admin.sql
└─ promote_owner.sql
```

> `flow_diagram.svg` と `*.preview.jsx` は参考・確認用です。アプリには含めません。

## 7. 起動して動作確認

```bash
npm run dev
```

`http://localhost:3000` を開き、次の順で確認する（縦の動作確認）：

1. 未ログインで開く → `/login` に飛ばされる（ルート保護OK）。
2. 新規登録（名前・メール・パスワード）→ ログインできる。
3. **最初のオーナーを作る**：SQL Editor で `promote_to_owner` を実行。
   ```sql
   select promote_to_owner('you@example.com');
   ```
   一度ログアウト→再ログインすると、オーナーとして `/schedule` に入る。

   > なぜ単純な `update profiles set role='owner'` ではダメか：
   > `profiles_admin.sql` の権限昇格防止トリガーが、`auth.uid()` の無い文脈
   > （SQL Editor）では role 変更を巻き戻すため、UPDATE は「成功」しても
   > role は変わりません。`promote_to_owner`（手順2-3で作成）はトリガーを
   > 一時無効化して安全に昇格し、一般ユーザーからは呼べないよう権限を絞って
   > あります。
4. オーナーで：従業員管理で雇用形態・上限時間を設定 → `/schedule` の
   「＋ 新規期間」から提出期間を作成（タイトル・開始/終了日・提出締切）。
5. 別アカウントを従業員として登録 → `/availability` で希望提出。
6. オーナーで希望を確定 → 公開。
7. 従業員で `/my-schedule` に確定シフトが出る。

> 提出期間の作成・受付締切・公開、確定シフトの CSV 出力はすべて
> `/schedule`（オーナー画面）の操作で完結します。従業員には未提出の
> リマインドバナーが自動表示されます。

## 8. デプロイ（Vercel）

1. GitHub にプッシュ → Vercel でインポート。
2. Vercel の **Environment Variables** に `.env.local` と同じ2つを設定。
3. デプロイ後の本番ドメインを、手順3の **Redirect URLs** と **Site URL** に追加。
4. スマホの本番URLで、Safari「ホーム画面に追加」/ Chrome のインストールを確認。
   （PWA・Service Worker は HTTPS の本番でのみ有効）

---

## 9. Web Push（提出リマインドのプッシュ通知）

アプリを閉じていても、未提出の従業員へ締切前にプッシュ通知を送る機能です。
**Service Worker は本番のみ有効**なので、確認は `npm run build && npm start`
かデプロイ環境で行います（iOS はホーム画面に追加した PWA のみ対応）。

### 9-1. DB を用意
SQL Editor で `supabase/push_subscriptions.sql` を実行（購読保存テーブル＋RLS）。

### 9-2. VAPID 鍵を生成
```bash
npx web-push generate-vapid-keys
```
出力された Public Key / Private Key を控える。

### 9-3. 環境変数を設定（`.env.local` と Vercel の両方）
`.env.local.example` を参照。次の5つを追加する。

```
SUPABASE_SERVICE_ROLE_KEY=（Settings → API の service_role key・秘密）
NEXT_PUBLIC_VAPID_PUBLIC_KEY=（9-2 の public key）
VAPID_PRIVATE_KEY=（9-2 の private key）
VAPID_SUBJECT=mailto:you@example.com
CRON_SECRET=（任意の長いランダム文字列）
```

> `SUPABASE_SERVICE_ROLE_KEY` と `VAPID_PRIVATE_KEY`、`CRON_SECRET` は秘密。
> `NEXT_PUBLIC_` を付けない（クライアントに漏らさない）。

### 9-4. 定期送信（cron）
- **Vercel**：`vercel.json` に毎日0:00(UTC)の cron を定義済み。Vercel は
  `CRON_SECRET` 設定時、`Authorization: Bearer <CRON_SECRET>` を自動付与するため、
  環境変数を入れてデプロイすれば有効になる（Hobbyプランは1日1回まで）。
- **手動テスト / 他基盤**：次のように送信APIを叩く。
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" \
    https://<本番ドメイン>/api/push/send-reminders
  ```
  返り値の `sent` が送信件数。`status=open` かつ締切が72時間以内で未提出の
  従業員の購読に送られる（送信ウィンドウは route 内 `REMIND_WITHIN_HOURS`）。

### 9-5. 動作確認
1. 本番（または `npm start`）で従業員ログイン → 上部の「通知をオンにする」を許可。
2. オーナーで、締切が3日以内の提出期間を用意（未提出状態にしておく）。
3. 9-4 の `curl` を実行 → 端末にプッシュ通知が届く。タップで `/availability` を開く。

---

## 補足メモ

- **無料プランの一時停止**：1週間アクセスがないとDBが停止する。GitHub Actions で
  数日おきに軽いクエリを投げて起こし続けると安心。
- **キー名**：新しいSupabaseプロジェクトは anon キーの代わりに
  publishable key を使う場合がある。どちらも `NEXT_PUBLIC_SUPABASE_ANON_KEY` に入れてよい。
- **Next.js 16 以降**：`middleware.ts` が `proxy` に名称変更。その場合は読み替える。
- **時間ロジックの共通化（任意）**：各画面に再掲している営業時間ロジックは
  `lib/shiftTime.ts` に切り出すと重複が消える。
- **Cookie の型注釈**：`strict` モードのビルドで `supabase/ssr` の `setAll`
  パラメータが暗黙 any になるため、`lib/supabaseServer.ts` と `middleware.ts` の
  `setAll(cookiesToSet: { name; value; options: CookieOptions }[])` に型注釈を付与済み
  （ロジックは公式パターンのまま）。

## 実装済みの追加機能

- 最初のオーナーを安全に作る管理関数（`promote_to_owner` / `supabase/promote_owner.sql`）
- 提出期間（shift_periods）の作成・締切・公開UI（`/schedule`）
- 希望提出のリマインド通知（アプリ内バナー / `components/SubmissionReminder.tsx`）
- シフトのCSV出力（Excel対応・UTF-8 BOM付き / `/schedule`）
- 希望提出リマインドの Web Push 化（手順9。`components/PushToggle.tsx` /
  `app/api/push/*` / `public/sw.js` / `supabase/push_subscriptions.sql`）

## まだ無い機能（必要になったら）

- 複数店舗対応（スキーマ変更を伴う）
```
