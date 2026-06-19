-- =============================================================
-- 0006_attendance — 実績勤怠（出退勤の打刻）
--   - スタッフがアプリで出勤/退勤を打刻し、オーナーが修正できる。
--   - 給与計算の基礎。実時刻(timestamptz)で記録するため日跨ぎ補正は不要。
--   - work_date は「営業日(開店日)」。深夜(閉店前)の打刻は前日の営業日に属する。
--   - v1 は休憩管理なし（将来 break_minutes 列を足せる設計）。
-- 前提: 0001・0002・0003 適用後。冪等。
-- =============================================================

create table if not exists attendance_records (
  id          uuid        primary key default gen_random_uuid(),
  store_id    uuid        not null references stores (id) on delete cascade,
  employee_id uuid        not null references profiles (id) on delete cascade,
  work_date   date        not null,            -- 営業日（開店日基準）
  clock_in    timestamptz not null,            -- 出勤時刻
  clock_out   timestamptz,                     -- 退勤時刻（勤務中は null）
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_attendance_emp_date on attendance_records (employee_id, work_date);
create index if not exists idx_attendance_store_date on attendance_records (store_id, work_date);

alter table attendance_records enable row level security;

-- 閲覧：本人＋オーナー
drop policy if exists "本人かオーナーは勤怠を閲覧可" on attendance_records;
create policy "本人かオーナーは勤怠を閲覧可" on attendance_records for select
  using (employee_id = auth.uid() or is_owner());

-- 作成：本人（所属店舗のみ）＋オーナー
drop policy if exists "本人(所属店舗)かオーナーは勤怠を作成可" on attendance_records;
create policy "本人(所属店舗)かオーナーは勤怠を作成可" on attendance_records for insert
  with check (
    is_owner()
    or (employee_id = auth.uid() and is_store_member(store_id))
  );

-- 更新：本人＋オーナー（本人が変更できる範囲はトリガーで制限）
drop policy if exists "本人かオーナーは勤怠を更新可" on attendance_records;
create policy "本人かオーナーは勤怠を更新可" on attendance_records for update
  using (employee_id = auth.uid() or is_owner());

-- 削除：オーナーのみ（給与の基礎データを守る）
drop policy if exists "勤怠の削除はオーナーのみ" on attendance_records;
create policy "勤怠の削除はオーナーのみ" on attendance_records for delete
  using (is_owner());

-- =============================================================
-- 打刻の改ざん防止トリガー（給与の基礎データの整合性）
--   非オーナーの更新では：
--     - clock_in / work_date / store_id / employee_id は変更不可
--     - clock_out は「未設定 → 設定」の一度きり（退勤後は本人は変更不可）
--   オーナーは全項目を修正できる。
-- =============================================================
create or replace function guard_attendance_staff_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_owner() then
    return new; -- オーナーは全項目修正可
  end if;
  new.clock_in    := old.clock_in;
  new.work_date   := old.work_date;
  new.store_id    := old.store_id;
  new.employee_id := old.employee_id;
  if old.clock_out is not null then
    new.clock_out := old.clock_out; -- 退勤済みは本人変更不可
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_attendance_staff on attendance_records;
create trigger trg_guard_attendance_staff
  before update on attendance_records
  for each row execute function guard_attendance_staff_edits();

-- ----- 適用記録 ----------------------------------------------
insert into schema_migrations (version) values ('0006_attendance')
  on conflict (version) do nothing;
