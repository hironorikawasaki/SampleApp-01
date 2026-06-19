-- =============================================================
-- 0002_profiles_admin — プロフィール管理の追加RLS＋特権カラム保護
--   1) オーナーが全員のプロフィールを更新できるようにする
--   2) 非オーナー（本人）が特権カラム（role/employment_type/
--      max_hours_per_month/is_active）を書き換えられないようにする
-- 前提: 0001_init_schema 適用後。冪等。
-- =============================================================

-- 1) オーナーは全員のプロフィールを更新可（本人更新ポリシーとORで併存）
drop policy if exists "オーナーは全員のプロフィールを更新可" on profiles;
create policy "オーナーは全員のプロフィールを更新可"
  on profiles for update
  using (is_owner())
  with check (is_owner());

-- 2) 特権カラムの保護トリガー
--    非オーナーの更新では特権カラムを変更前の値に強制的に戻す。
create or replace function guard_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_owner() then
    return new;  -- オーナーは全カラム変更可
  end if;
  new.role                := old.role;
  new.employment_type     := old.employment_type;
  new.max_hours_per_month := old.max_hours_per_month;
  new.is_active           := old.is_active;
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_privileged on profiles;
create trigger trg_guard_profile_privileged
  before update on profiles
  for each row execute function guard_profile_privileged_columns();

-- ----- 適用記録 ----------------------------------------------
insert into schema_migrations (version) values ('0002_profiles_admin')
  on conflict (version) do nothing;
