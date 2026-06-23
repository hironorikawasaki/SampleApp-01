-- =============================================================
-- 0009_kiosk_punch_fix — キオスク打刻の営業日跨ぎ対策
--   問題: 退勤し忘れ（clock_out=null）が残っていると、翌営業日の「出勤」タップが
--         その古い打刻を now() で退勤扱いにしてしまい、当日の出勤が記録されない。
--   対策: 「未退勤の打刻」を当日(p_work_date)に限定して退勤判定する。
--         別営業日の未退勤が残っていても当日は新規出勤として記録し、
--         古い打刻はそのまま残してオーナーが /timecards で補正する。
-- 前提: 0006・0008 適用後。冪等。
-- =============================================================

create or replace function kiosk_punch(
  p_employee uuid,
  p_store uuid,
  p_pin text,
  p_work_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
  v_open attendance_records%rowtype;
begin
  if not is_owner() then
    return jsonb_build_object('error', 'オーナー端末でのみ打刻できます');
  end if;

  select exists (
    select 1
    from profiles pr
    join store_members sm on sm.employee_id = pr.id and sm.store_id = p_store
    where pr.id = p_employee
      and pr.is_active
      and pr.pin is not null
      and pr.pin = p_pin
  ) into v_ok;
  if not v_ok then
    return jsonb_build_object('error', 'PINが正しくありません');
  end if;

  -- 「当日(同一営業日)」の未退勤打刻のみを退勤対象にする
  select * into v_open
  from attendance_records
  where employee_id = p_employee
    and store_id = p_store
    and work_date = p_work_date
    and clock_out is null
  order by clock_in desc
  limit 1;

  if found then
    update attendance_records set clock_out = now() where id = v_open.id;
    return jsonb_build_object('action', 'out', 'at', now());
  else
    insert into attendance_records (store_id, employee_id, work_date, clock_in)
    values (p_store, p_employee, p_work_date, now());
    return jsonb_build_object('action', 'in', 'at', now());
  end if;
end;
$$;

-- ----- 適用記録 ----------------------------------------------
insert into schema_migrations (version) values ('0009_kiosk_punch_fix')
  on conflict (version) do nothing;
