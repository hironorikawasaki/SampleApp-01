-- =============================================================
-- Web Push 用：プッシュ購読情報の保存テーブル
--   - 各従業員の端末（ブラウザ）ごとの購読を保存。
--   - 1端末 = 1 endpoint。endpoint を一意キーにして重複を防ぐ。
--   - 送信側（cron / API）は service_role で全件を読む（RLSをバイパス）。
--   - 本人は自分の購読のみ作成・削除できる。
-- Supabase の SQL Editor で実行してください（schema 適用後ならいつでも可）。
-- =============================================================

create table if not exists push_subscriptions (
  id          uuid        primary key default gen_random_uuid(),
  employee_id uuid        not null references profiles (id) on delete cascade,
  endpoint    text        not null unique,
  p256dh      text        not null,
  auth        text        not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_push_sub_employee on push_subscriptions (employee_id);

alter table push_subscriptions enable row level security;

-- 本人は自分の購読のみ操作可（owner も自分の分のみ。送信は service_role）
drop policy if exists "本人は自分のプッシュ購読を管理" on push_subscriptions;
create policy "本人は自分のプッシュ購読を管理"
  on push_subscriptions for all
  using (employee_id = auth.uid())
  with check (employee_id = auth.uid());
