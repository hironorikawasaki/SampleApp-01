-- =============================================================
-- 複数店舗対応マイグレーション
--   - stores            : 店舗マスタ
--   - store_members     : 従業員と店舗の多対多（1人が複数店舗に所属可）
--   - shift_periods.store_id : 提出期間を店舗に紐付け
--   - オーナー(role='owner')は全店舗を管理できる（グローバル）。
--     従業員は自分が所属する店舗の期間のみ閲覧・提出できる。
--   - 既存データは「本店」を作成して移行する。
-- 実行順: shift_app_schema.sql / profiles_admin.sql の後に SQL Editor で実行。
-- =============================================================

-- 1) 店舗マスタ
create table if not exists stores (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  is_active  boolean     not null default true,
  created_at timestamptz not null default now()
);

-- 2) 従業員 × 店舗（多対多）
create table if not exists store_members (
  store_id    uuid        not null references stores (id) on delete cascade,
  employee_id uuid        not null references profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (store_id, employee_id)
);
create index if not exists idx_store_members_emp on store_members (employee_id);

-- 3) 提出期間に店舗を追加（まずは nullable で追加 → 移行 → not null）
alter table shift_periods add column if not exists store_id uuid references stores (id) on delete cascade;
create index if not exists idx_shift_periods_store on shift_periods (store_id);

-- 4) 店舗所属の判定ヘルパー（RLSから呼ぶ）
create or replace function is_store_member(target uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from store_members
    where store_id = target and employee_id = auth.uid()
  );
$$;

-- 5) 既存データの移行：店舗が無ければ「本店」を作り、既存の期間と従業員を割り当てる
insert into stores (name)
select '本店'
where not exists (select 1 from stores);

update shift_periods
set store_id = (select id from stores order by created_at, id limit 1)
where store_id is null;

insert into store_members (store_id, employee_id)
select (select id from stores order by created_at, id limit 1), p.id
from profiles p
where p.role = 'employee'
on conflict do nothing;

-- 移行後は必須に
alter table shift_periods alter column store_id set not null;

-- =============================================================
-- Row Level Security
-- =============================================================
alter table stores        enable row level security;
alter table store_members enable row level security;

-- stores: 認証済みは閲覧可、管理はオーナーのみ
drop policy if exists "店舗は認証ユーザーが閲覧可" on stores;
create policy "店舗は認証ユーザーが閲覧可" on stores for select
  using (auth.uid() is not null);
drop policy if exists "店舗の管理はオーナーのみ" on stores;
create policy "店舗の管理はオーナーのみ" on stores for all
  using (is_owner()) with check (is_owner());

-- store_members: 本人かオーナーが閲覧、管理はオーナーのみ
drop policy if exists "所属は本人かオーナーが閲覧" on store_members;
create policy "所属は本人かオーナーが閲覧" on store_members for select
  using (employee_id = auth.uid() or is_owner());
drop policy if exists "所属の管理はオーナーのみ" on store_members;
create policy "所属の管理はオーナーのみ" on store_members for all
  using (is_owner()) with check (is_owner());

-- shift_periods: 「全員閲覧可」を「所属店舗の従業員＋オーナー」に置き換え
drop policy if exists "提出期間は全員閲覧可" on shift_periods;
drop policy if exists "提出期間は所属店舗の従業員とオーナーが閲覧" on shift_periods;
create policy "提出期間は所属店舗の従業員とオーナーが閲覧" on shift_periods for select
  using (is_owner() or is_store_member(store_id));
-- 管理ポリシー（オーナーのみ）は既存のまま

-- shift_preferences: 「受付中」に加えて「所属店舗の期間」であることを要求
drop policy if exists "受付中の期間に自分の希望を提出可" on shift_preferences;
drop policy if exists "受付中の所属店舗の期間に自分の希望を提出可" on shift_preferences;
create policy "受付中の所属店舗の期間に自分の希望を提出可" on shift_preferences for insert
  with check (
    employee_id = auth.uid()
    and exists (
      select 1 from shift_periods p
      where p.id = period_id and p.status = 'open' and is_store_member(p.store_id)
    )
  );

drop policy if exists "受付中なら自分の希望を編集可" on shift_preferences;
drop policy if exists "受付中の所属店舗なら自分の希望を編集可" on shift_preferences;
create policy "受付中の所属店舗なら自分の希望を編集可" on shift_preferences for update
  using (
    employee_id = auth.uid()
    and exists (
      select 1 from shift_periods p
      where p.id = period_id and p.status = 'open' and is_store_member(p.store_id)
    )
  );

drop policy if exists "受付中なら自分の希望を削除可・オーナーは常時可" on shift_preferences;
drop policy if exists "受付中の所属店舗なら自分の希望を削除可・オーナーは常時可" on shift_preferences;
create policy "受付中の所属店舗なら自分の希望を削除可・オーナーは常時可" on shift_preferences for delete
  using (
    is_owner()
    or (employee_id = auth.uid()
        and exists (
          select 1 from shift_periods p
          where p.id = period_id and p.status = 'open' and is_store_member(p.store_id)
        ))
  );
