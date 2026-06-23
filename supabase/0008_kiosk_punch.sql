-- =============================================================
-- 0008_kiosk_punch — 店舗キオスク打刻（オーナー端末＋従業員PIN）
--   - 店舗のPad等をオーナーアカウントでログインして据え置く。
--   - 従業員は名前をタップ→4桁PINで出勤/退勤（個人ログイン不要）。
--   - kiosk_punch RPC が PIN照合と打刻トグル（出勤⇄退勤）を行う。
--     打刻時刻はサーバ now()。生の実時刻を保持し、15分丸めは集計時に行う。
-- 前提: 0001・0003・0006 適用後。冪等。
-- =============================================================

-- 従業員PIN（4桁想定。profiles の閲覧RLSは本人＋オーナーのみなので外部に漏れない）
alter table profiles add column if not exists pin text;

-- キオスク打刻：オーナーセッションからのみ実行可。PIN照合の上で出勤/退勤を切替。
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

  -- 在籍・所属・PIN照合
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

  -- 未退勤の打刻があれば退勤、無ければ出勤（トグル）
  select * into v_open
  from attendance_records
  where employee_id = p_employee and store_id = p_store and clock_out is null
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

-- 匿名からは不可。authenticated は実行可だが関数内で is_owner() を必須化。
revoke all on function kiosk_punch(uuid, uuid, text, date) from public;
revoke all on function kiosk_punch(uuid, uuid, text, date) from anon;
grant execute on function kiosk_punch(uuid, uuid, text, date) to authenticated;

-- ----- 適用記録 ----------------------------------------------
insert into schema_migrations (version) values ('0008_kiosk_punch')
  on conflict (version) do nothing;
