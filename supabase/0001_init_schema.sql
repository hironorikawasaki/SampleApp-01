-- =============================================================
-- 0001_init_schema — 飲食店向けシフト管理アプリ 基本スキーマ v2
-- 運用: 従業員が「希望シフト」を提出 → オーナーが確定シフトを作成
-- 冪等: 何度実行しても安全（IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS）。
-- Supabase の SQL Editor に貼り付けて実行できます。
-- =============================================================

-- ----- 適用済みマイグレーションの記録テーブル ----------------
create table if not exists schema_migrations (
  version    text        primary key,
  applied_at timestamptz not null default now()
);

-- ----- 役割・雇用形態・状態を表す型（ENUM）-------------------
-- CREATE TYPE は IF NOT EXISTS が無いため DO ブロックで存在チェックする。
do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('employee', 'owner');
  end if;
  if not exists (select 1 from pg_type where typname = 'employment_type') then
    create type employment_type as enum ('regular', 'part_time'); -- 正社員 / アルバイト・パート
  end if;
  if not exists (select 1 from pg_type where typname = 'period_status') then
    create type period_status as enum ('open', 'closed', 'published'); -- 受付中 / 締切調整中 / 確定公開
  end if;
  if not exists (select 1 from pg_type where typname = 'preference_type') then
    create type preference_type as enum ('preferred', 'available', 'unavailable'); -- 希望 / 勤務可能 / NG
  end if;
end $$;

-- =============================================================
-- 1. profiles : ログインユーザーの追加情報
-- =============================================================
create table if not exists profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  full_name           text            not null,
  role                user_role       not null default 'employee',
  employment_type     employment_type not null default 'part_time',
  max_hours_per_month numeric,
  phone               text,
  is_active           boolean         not null default true,
  created_at          timestamptz     not null default now()
);

-- =============================================================
-- 2. shift_periods : 希望提出の単位（例「2026年6月後半」＋締切）
-- =============================================================
create table if not exists shift_periods (
  id                  uuid          primary key default gen_random_uuid(),
  title               text          not null,
  start_date          date          not null,
  end_date            date          not null,
  submission_deadline timestamptz   not null,
  status              period_status not null default 'open',
  created_by          uuid          not null references profiles (id),
  created_at          timestamptz   not null default now()
);

-- =============================================================
-- 3. shift_preferences : 従業員が提出する希望シフト
-- =============================================================
create table if not exists shift_preferences (
  id          uuid            primary key default gen_random_uuid(),
  period_id   uuid            not null references shift_periods (id) on delete cascade,
  employee_id uuid            not null references profiles (id) on delete cascade,
  work_date   date            not null,
  start_time  time,
  end_time    time,
  preference  preference_type not null default 'preferred',
  note        text,
  created_at  timestamptz     not null default now()
);
create index if not exists idx_pref_period_emp on shift_preferences (period_id, employee_id);
create index if not exists idx_pref_date       on shift_preferences (work_date);

-- =============================================================
-- 4. confirmed_shifts : オーナーが確定した実シフト
-- =============================================================
create table if not exists confirmed_shifts (
  id          uuid        primary key default gen_random_uuid(),
  period_id   uuid        not null references shift_periods (id) on delete cascade,
  employee_id uuid        not null references profiles (id) on delete cascade,
  work_date   date        not null,
  start_time  time        not null,
  end_time    time        not null,              -- 深夜跨ぎ(例 22:00-02:00)は end < start で表現
  position    text,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_conf_period_emp on confirmed_shifts (period_id, employee_id);
create index if not exists idx_conf_date       on confirmed_shifts (work_date);

-- =============================================================
-- 集計ビュー : 確定シフトの合計時間（security_invoker で各ユーザーのRLS適用）
-- =============================================================
create or replace view v_confirmed_hours
with (security_invoker = on) as
select
  period_id,
  employee_id,
  count(*) as shift_count,
  round(sum(
    case
      when end_time >= start_time
        then extract(epoch from (end_time - start_time)) / 3600
      else extract(epoch from (end_time - start_time + interval '24 hours')) / 3600
    end
  )::numeric, 2) as total_hours
from confirmed_shifts
group by period_id, employee_id;

-- =============================================================
-- 役割判定のヘルパー関数（RLSポリシーから呼ぶ）
-- =============================================================
create or replace function is_owner()
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'owner');
$$;

-- =============================================================
-- Row Level Security
-- =============================================================
alter table profiles          enable row level security;
alter table shift_periods     enable row level security;
alter table shift_preferences enable row level security;
alter table confirmed_shifts  enable row level security;

-- --- profiles ---
drop policy if exists "本人かオーナーは閲覧可" on profiles;
create policy "本人かオーナーは閲覧可" on profiles for select
  using (id = auth.uid() or is_owner());
drop policy if exists "本人は自分の情報を更新可" on profiles;
create policy "本人は自分の情報を更新可" on profiles for update
  using (id = auth.uid());

-- --- shift_periods（提出期間は全員が閲覧、作成・管理はオーナーのみ）---
drop policy if exists "提出期間は全員閲覧可" on shift_periods;
create policy "提出期間は全員閲覧可" on shift_periods for select
  using (true);
drop policy if exists "提出期間の管理はオーナーのみ" on shift_periods;
create policy "提出期間の管理はオーナーのみ" on shift_periods for all
  using (is_owner()) with check (is_owner());

-- --- shift_preferences（希望は本人のみ操作、ただし受付中の期間に限る）---
drop policy if exists "自分の希望かオーナーは閲覧可" on shift_preferences;
create policy "自分の希望かオーナーは閲覧可" on shift_preferences for select
  using (employee_id = auth.uid() or is_owner());
drop policy if exists "受付中の期間に自分の希望を提出可" on shift_preferences;
create policy "受付中の期間に自分の希望を提出可" on shift_preferences for insert
  with check (
    employee_id = auth.uid()
    and exists (select 1 from shift_periods p where p.id = period_id and p.status = 'open')
  );
drop policy if exists "受付中なら自分の希望を編集可" on shift_preferences;
create policy "受付中なら自分の希望を編集可" on shift_preferences for update
  using (
    employee_id = auth.uid()
    and exists (select 1 from shift_periods p where p.id = period_id and p.status = 'open')
  );
drop policy if exists "受付中なら自分の希望を削除可・オーナーは常時可" on shift_preferences;
create policy "受付中なら自分の希望を削除可・オーナーは常時可" on shift_preferences for delete
  using (
    is_owner()
    or (employee_id = auth.uid()
        and exists (select 1 from shift_periods p where p.id = period_id and p.status = 'open'))
  );

-- --- confirmed_shifts（閲覧は本人＋オーナー、作成・編集はオーナーのみ）---
drop policy if exists "自分の確定シフトかオーナーは閲覧可" on confirmed_shifts;
create policy "自分の確定シフトかオーナーは閲覧可" on confirmed_shifts for select
  using (employee_id = auth.uid() or is_owner());
drop policy if exists "確定シフトの管理はオーナーのみ" on confirmed_shifts;
create policy "確定シフトの管理はオーナーのみ" on confirmed_shifts for all
  using (is_owner()) with check (is_owner());

-- =============================================================
-- 新規サインアップ時に profiles を自動作成
-- =============================================================
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', '名称未設定'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ----- 適用記録 ----------------------------------------------
insert into schema_migrations (version) values ('0001_init_schema')
  on conflict (version) do nothing;
