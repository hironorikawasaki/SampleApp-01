-- =============================================================
-- 従業員プロフィール管理のための追加マイグレーション
--   1) オーナーが全員のプロフィールを更新できるようにする
--   2) 非オーナー（本人）が特権カラムを書き換えられないようにする
--      （role / employment_type / max_hours_per_month / is_active）
-- Supabase の SQL Editor で実行してください。
-- =============================================================

-- 1) オーナーは全員のプロフィールを更新可
--    （既存の「本人は自分の情報を更新可」と併存。複数ポリシーはORで評価）
create policy "オーナーは全員のプロフィールを更新可"
  on profiles for update
  using (is_owner())
  with check (is_owner());

-- 2) 特権カラムの保護トリガー
--    非オーナーによる更新では、特権カラムを変更前の値に強制的に戻す。
--    → 本人は氏名・電話など一般項目のみ変更でき、role等は書き換え不可。
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
  -- 非オーナー：特権カラムは元の値を維持（昇格・上限改ざんを防止）
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
