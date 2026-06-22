-- =============================================================
-- 0007_calendar_foundation — カレンダー/ロスター/備考の基盤
--   1) day_notes        : 日別の備考（その日全体の自由文メモ）
--   2) confirmed_shifts : 公開済み期間は同店舗の従業員も同僚分を閲覧可（ロスター用）
--   3) coworker_profiles: 氏名だけを安全に引くビュー（profiles の機微列は晒さない）
-- 前提: 0001・0002・0003 適用後。冪等。
-- =============================================================

-- 1) 日別の備考（store_id × work_date で1件。出勤初日・誕生日などの自由文）
create table if not exists day_notes (
  id         uuid        primary key default gen_random_uuid(),
  store_id   uuid        not null references stores (id) on delete cascade,
  work_date  date        not null,
  note       text        not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, work_date)
);
create index if not exists idx_day_notes_store_date on day_notes (store_id, work_date);

alter table day_notes enable row level security;

drop policy if exists "備考は同店舗の従業員とオーナーが閲覧" on day_notes;
create policy "備考は同店舗の従業員とオーナーが閲覧" on day_notes for select
  using (is_owner() or is_store_member(store_id));

drop policy if exists "備考の管理はオーナーのみ" on day_notes;
create policy "備考の管理はオーナーのみ" on day_notes for all
  using (is_owner()) with check (is_owner());

-- 2) 同僚の確定シフトを「公開済み期間」かつ「同店舗」に限り閲覧可にする。
--    既存の「本人＋オーナー」ポリシーと併存（permissive は OR 評価）。
drop policy if exists "公開済み期間は同店舗の従業員も確定を閲覧可" on confirmed_shifts;
create policy "公開済み期間は同店舗の従業員も確定を閲覧可" on confirmed_shifts for select
  using (
    exists (
      select 1 from shift_periods p
      where p.id = confirmed_shifts.period_id
        and p.status = 'published'
        and is_store_member(p.store_id)
    )
  );

-- 3) 氏名だけを返す安全なビュー。
--    profiles を直接開放すると雇用形態・月上限・電話まで晒すため、
--    id と full_name のみを「同店舗の同僚（オーナーは全員）」に限定して公開する。
--    security_invoker = off によりビュー所有者権限で実行し、WHERE で行を限定する。
create or replace view coworker_profiles
with (security_invoker = off) as
  select p.id, p.full_name
  from profiles p
  where is_owner()
     or exists (
       select 1
       from store_members m_self
       join store_members m_other on m_other.store_id = m_self.store_id
       where m_self.employee_id = auth.uid()
         and m_other.employee_id = p.id
     );

grant select on coworker_profiles to anon, authenticated;

-- ----- 適用記録 ----------------------------------------------
insert into schema_migrations (version) values ('0007_calendar_foundation')
  on conflict (version) do nothing;
