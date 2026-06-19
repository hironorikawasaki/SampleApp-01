# 新規オーナー導入ランブック（方式B / サイロ型）

オーナー（店舗）を 1 件追加するたびに、上から順に実行する手順書です。
**1 オーナー = 1 Supabase プロジェクト + 1 Vercel プロジェクト**（DB は物理分離）。
コードはこの共有コアリポジトリの `main` から派生させ、店舗ごとの差分は
環境変数（`NEXT_PUBLIC_*`）で吸収します（→ `lib/config.ts`）。

> 所要時間の目安：30〜60 分（カスタマイズなしの素の導入）。
> 開発全般のリファレンスは [SETUP.md](../SETUP.md) を参照（本書はそれを運用向けに圧縮した反復用チェックリスト）。

---

## 0. 事前にオーナーから収集する情報

| 項目 | 例 | 使いみち |
|---|---|---|
| アプリ名（ブランド名） | `Club ○○` | `NEXT_PUBLIC_BRAND_NAME`（PWA名・タイトル） |
| 店名（ログイン画面の見出し） | `○○ 店` | `NEXT_PUBLIC_STORE_NAME` |
| 営業時間（開店・閉店） | `19:00` 〜 翌 `02:00` | `NEXT_PUBLIC_OPEN_TIME` / `NEXT_PUBLIC_CLOSE_TIME` |
| 時間選択の刻み | 30 分 | `NEXT_PUBLIC_SLOT_MINUTES`（既定 30） |
| 定番シフト（任意） | 通し / 前半 / 後半 … | `NEXT_PUBLIC_SHIFT_PRESETS`（JSON・任意） |
| 希望ドメイン（任意） | `shift.example.com` | Vercel のカスタムドメイン |
| オーナーのログイン用メール | `owner@example.com` | 最初のオーナー昇格に使用 |
| 連絡先メール | `mailto:` 用 | `VAPID_SUBJECT` |

> カスタマイズ（設定で吸収できない個別要望）がある場合は、共有コアに反映できるか
> まず検討し、店舗固有のものだけ `customer/<slug>` ブランチで差分管理する（フルフォーク禁止）。

---

## 1. Supabase プロジェクトを作成

- [ ] supabase.com で新規プロジェクト作成（**Region: Tokyo (ap-northeast-1)** 推奨）。
- [ ] プラン：本番提供は **Pro**（無料は7日無アクセスで自動停止＝本番不可）。
- [ ] **Settings → API** から控える：
  - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
  - `anon` / `publishable` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `service_role` key（**秘密**） → `SUPABASE_SERVICE_ROLE_KEY`

## 2. データベースを構築（SQL Editor で順番に実行）

**Settings → SQL Editor** で、必ずこの順に貼り付けて実行する：

1. [ ] `supabase/shift_app_schema.sql` … 型・テーブル・RLS・トリガー一式
2. [ ] `supabase/profiles_admin.sql` … プロフィール管理 RLS ＋ 権限昇格防止トリガー
3. [ ] `supabase/multi_store.sql` … 店舗マスタ・所属・店舗別 RLS（既存無しでも可。`本店` を自動作成）
4. [ ] `supabase/push_subscriptions.sql` … Web Push 購読テーブル
5. [ ] `supabase/promote_owner.sql` … 最初のオーナーを昇格する管理関数（手順 7 で使用）

> 順序が重要：`1 → 2` は前後不可。`promote_owner`(5) は `profiles_admin`(2) の
> トリガー作成後でないと動かない。`multi_store`(3) は `1・2` の後。

## 3. 認証の設定（Supabase ダッシュボード）

- [ ] **Authentication → Providers → Email** を有効化。
  - 本番は **Confirm email = オン** 推奨（なりすまし防止）。
- [ ] **Authentication → URL Configuration**
  - **Site URL**：本番ドメイン（手順 5 でドメイン確定後に設定）
  - **Redirect URLs** に追加：
    - `https://<本番ドメイン>/auth/callback`
    - `https://<Vercelプレビュー>/auth/callback`（プレビュー検証する場合）
    - `http://localhost:3000/auth/callback`（ローカル検証する場合）
- [ ] （本番）標準メールは送信制限が厳しい。**SMTP に Resend 等**を設定。

## 4. VAPID 鍵を生成（オーナーごとに新規・使い回さない）

```bash
npx web-push generate-vapid-keys
```

- [ ] `Public Key` → `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- [ ] `Private Key`（**秘密**） → `VAPID_PRIVATE_KEY`

## 5. Vercel プロジェクトを作成

- [ ] この共有コアリポジトリを Vercel に **Import**（オーナーごとに別プロジェクトとして）。
  - 標準デプロイは `main` から。店舗固有ブランチを使う場合は Production Branch をそれに設定。
- [ ] **Settings → Domains** で本番ドメインを設定（独自ドメイン or `*.vercel.app`）。
  - 確定したドメインを手順 3 の **Site URL / Redirect URLs** に反映。
- [ ] **Settings → Deployment Protection**：本番は **オフ**（オンだと cron が 401 になる）。

## 6. 環境変数を設定（Vercel：Production / Preview / Development すべて）

> `CRON_SECRET` は `openssl rand -base64 32` 等で生成した長いランダム文字列。
> `NEXT_PUBLIC_*` はビルド時に埋め込まれるため、**変更後は再デプロイが必要**。

| 変数 | 取得元 | 秘密 |
|---|---|:--:|
| `NEXT_PUBLIC_SUPABASE_URL` | 手順 1 | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 手順 1 | |
| `SUPABASE_SERVICE_ROLE_KEY` | 手順 1 | 🔒 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | 手順 4 | |
| `VAPID_PRIVATE_KEY` | 手順 4 | 🔒 |
| `VAPID_SUBJECT` | `mailto:<連絡先>` | |
| `CRON_SECRET` | 自分で生成 | 🔒 |
| `NEXT_PUBLIC_BRAND_NAME` | 手順 0 | |
| `NEXT_PUBLIC_STORE_NAME` | 手順 0 | |
| `NEXT_PUBLIC_OPEN_TIME` | 手順 0 | |
| `NEXT_PUBLIC_CLOSE_TIME` | 手順 0 | |
| `NEXT_PUBLIC_SLOT_MINUTES` | 手順 0（任意・既定30） | |
| `NEXT_PUBLIC_SHIFT_PRESETS` | 手順 0（任意・JSON） | |

- [ ] 上記をすべて設定 → **Deploy**（環境変数反映のため再デプロイ）。
- [ ] `vercel.json` の cron（毎日 0:00 UTC = 9:00 JST に `/api/push/send-reminders`）が
  有効になっていることを確認。Vercel が `Authorization: Bearer <CRON_SECRET>` を自動付与。

## 7. 最初のオーナーを作成（ブートストラップ）

- [ ] 本番URLを開き、オーナー本人のメールで **新規登録**（手順 0 のメール）。
- [ ] Supabase SQL Editor で昇格：
  ```sql
  select promote_to_owner('owner@example.com');
  ```
- [ ] 一度 **ログアウト → 再ログイン** → `/schedule`（オーナー画面）に入れることを確認。

> 単純な `update profiles set role='owner'` は不可（権限昇格防止トリガーが SQL Editor 文脈で
> role を巻き戻すため）。必ず `promote_to_owner` を使う。

## 8. 受け入れ確認（スモークテスト）

- [ ] 未ログインで本番URL → `/login` にリダイレクトされる。
- [ ] アプリ名・店名・営業時間が手順 0 の設定どおり表示される。
- [ ] オーナー：`/stores` で店舗作成 →（必要なら）複数店舗。
- [ ] オーナー：`/employees` で従業員の所属店舗・雇用形態・上限時間を設定。
- [ ] オーナー：`/schedule` で「＋新規期間」→ 提出期間を作成。
- [ ] 従業員：別アカウントで登録 → オーナーが所属店舗を割当 → `/availability` で希望提出。
- [ ] オーナー：希望を確定 → 公開。従業員 `/my-schedule` に反映。
- [ ] CSV 出力が開ける。
- [ ] Web Push：従業員で「通知をオンにする」を許可 →
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://<本番ドメイン>/api/push/send-reminders
  ```
  を実行し、未提出があれば端末に通知が届く（`sent` が送信件数）。
- [ ] スマホで「ホーム画面に追加」→ PWA として起動する。

## 9. 引き渡し・記録

- [ ] オーナーへ：本番URL、ログイン方法、最初の店舗/従業員/期間の作り方を共有。
- [ ] 本オーナーの管理情報を**安全な場所**（パスワードマネージャ等。リポジトリに置かない）に記録：
  - Supabase プロジェクト名 / URL、Vercel プロジェクト名、本番ドメイン
  - 設定した `NEXT_PUBLIC_*` の値（カスタマイズ内容）
  - 秘密鍵の保管場所（service_role / VAPID private / CRON_SECRET）
  - 課金（プラン・請求先）
- [ ] 下の「オーナー台帳」へ 1 行追加（秘密情報は書かない）。

---

## オーナー台帳（秘密情報は記載しない）

| # | 店舗 | 本番ドメイン | Supabase プロジェクト | Vercel プロジェクト | ブランチ | 導入日 |
|---|------|------------|---------------------|--------------------|---------|--------|
| 1 | （例）Club ○○ | shift.example.com | sampleapp-clubmaru | clubmaru-shift | main | 2026-0X-XX |

---

## 解約・データ削除（オフボーディング）

- [ ] オーナーへ最終データ（CSV 等）を提供。
- [ ] Vercel プロジェクトを削除（または一時停止）。
- [ ] Supabase プロジェクトを削除（個人情報＝氏名・電話を含むため、保持方針に従い確実に削除）。
- [ ] ドメイン・DNS を解除。
- [ ] オーナー台帳から該当行を削除し、秘密情報の保管も破棄。

---

## トラブルシュート

| 症状 | 主な原因 / 対処 |
|---|---|
| ログイン後にループ / 401 | Redirect URLs 未登録、または Deployment Protection がオン |
| cron が 401 | `CRON_SECRET` 未設定、または Deployment Protection オン |
| 設定（店名・営業時間）が変わらない | `NEXT_PUBLIC_*` 変更後に**再デプロイ**していない |
| プッシュが届かない | 本番(HTTPS)でない / VAPID 鍵不一致 / 通知未許可 / iOS はホーム画面追加が必須 |
| DB が突然停止 | Supabase が無料プラン（→ Pro へ）/ 長期無アクセス |
| role が owner にならない | `update` ではなく `promote_to_owner` を使う |
