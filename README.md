# SampleApp-01

シフト管理アプリ（Sample）

夜間営業の店舗を想定した、希望シフトの提出・確定・共有を行う PWA です。
従業員は希望シフトを提出し、オーナーが確定・公開、従業員は確定シフトを確認できます。

## 主な機能

**従業員**
- 希望シフトの提出（希望 / 勤務可能 / NG=休み希望）
- 確定シフトの確認（`/my-schedule`）
- 未提出のリマインドバナー（締切が近いと自動表示）

**オーナー**
- 提出期間の作成・受付締切・公開（画面操作で完結）
- 日ごとに全員の希望を一覧し、ワンタップで確定／時間・担当の調整／手動追加
- 従業員ごとの確定合計時間と月上限の比較（扶養・契約の上限管理）
- 確定シフトの **CSV 出力**（Excel 対応・UTF-8 BOM 付き）
- 従業員管理（雇用形態・月上限時間・有効/無効）

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
│  └─ (app)/                    ログイン後の共通レイアウト＋各画面
│     ├─ availability/          希望提出（従業員）
│     ├─ my-schedule/           確定シフト確認（従業員）
│     ├─ schedule/              シフト作成・期間作成・CSV出力（オーナー）
│     └─ employees/             従業員管理（オーナー）
├─ components/                  AuthScreen / AppNav / SubmissionReminder / SW登録
├─ lib/                         Supabase クライアント（ブラウザ / サーバー）
├─ public/                      Service Worker・アイコン
└─ supabase/                    SQL（スキーマ / RLS追加 / オーナー昇格関数）
```
