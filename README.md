# SampleApp-01

シフト管理アプリ（Sample）

夜間営業の店舗を想定した、希望シフトの提出・確定・共有を行う PWA です。
従業員は希望シフトを提出し、オーナーが確定・公開、従業員は確定シフトを確認できます。

## 主な機能

**従業員**
- 希望シフトの提出（希望 / 勤務可能 / NG=休み希望）
- 確定シフトの確認（`/my-schedule`）
- 未提出のリマインドバナー（締切が近いと自動表示）
- 提出忘れの Web Push 通知（締切前に端末へプッシュ。オプトイン）

**オーナー**
- 提出期間の作成・受付締切・公開（画面操作で完結）
- 日ごとに全員の希望を一覧し、ワンタップで確定／時間・担当の調整／手動追加
- 従業員ごとの確定合計時間と月上限の比較（扶養・契約の上限管理）
- 確定シフトの **CSV 出力**（Excel 対応・UTF-8 BOM 付き）
- 従業員管理（雇用形態・月上限時間・有効/無効・店舗割り当て）
- **複数店舗対応**（店舗の作成、店舗ごとのシフト。オーナーは全店舗を管理、従業員は所属店舗のみ）

**共通 / 基盤**
- メール＋パスワード／マジックリンクによる認証（Supabase Auth）
- 役割（owner / employee）に応じたルーティングと Row Level Security
- PWA（ホーム画面に追加・オフライン簡易フォールバック）

## 技術スタック

- **Next.js 15**（App Router）/ **React 19** / **TypeScript**
- **Tailwind CSS v4**
- **Supabase**（Postgres / Auth / RLS）— `@supabase/ssr`
- デプロイ想定：**Vercel**

## セットアップ

構築手順は **[SETUP.md](./SETUP.md)** を参照してください（Supabase プロジェクト作成 → DB → 認証設定 → 起動 → デプロイ）。

新しいオーナー（店舗）を 1 件追加する反復用チェックリストは
**[docs/new-owner-onboarding.md](./docs/new-owner-onboarding.md)** にあります（方式B / サイロ型の運用ランブック）。

ローカル起動の概略：

```bash
npm install
# .env.local に Supabase の URL とキーを設定（.env.local.example を参照）
npm run dev
```

## ディレクトリ構成

```
SampleApp-01/
├─ middleware.ts                ルート保護（未ログインは /login へ）
├─ app/
│  ├─ layout.tsx                ルートレイアウト（PWAメタ・SW登録）
│  ├─ page.tsx                  役割別の振り分け
│  ├─ manifest.ts               PWA マニフェスト
│  ├─ login/                    ログイン / 新規登録
│  ├─ auth/callback/            メール確認・マジックリンクの戻り先
│  ├─ api/push/                 購読保存・リマインド送信(cron)
│  └─ (app)/                    ログイン後の共通レイアウト＋各画面
│     ├─ availability/          希望提出（従業員）
│     ├─ my-schedule/           確定シフト確認（従業員）
│     ├─ schedule/              シフト作成・期間作成・CSV出力（オーナー）
│     ├─ employees/             従業員管理・店舗割り当て（オーナー）
│     └─ stores/                店舗管理（オーナー）
├─ components/                  AuthScreen / AppNav / SubmissionReminder / PushToggle / SW登録
├─ lib/                         Supabase クライアント（ブラウザ / サーバー / admin）・web-push設定
├─ public/                      Service Worker（push対応）・アイコン
├─ vercel.json                  リマインド送信の定期実行(cron)
└─ supabase/                    SQL（スキーマ / RLS追加 / オーナー昇格 / push購読 / 複数店舗）
```
