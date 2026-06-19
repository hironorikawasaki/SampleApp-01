-- =============================================================
-- 0005_promote_owner — 指定メールのユーザーを安全に「オーナー」へ昇格
--   - 最初のオーナーを作る（ブートストラップ）用途。
--   - 0002 の特権カラム保護トリガーを一時無効化して確実に昇格する。
--   - PUBLIC / anon / authenticated からは EXECUTE を剥奪（自己昇格を防止）。
-- 前提: 0001・0002 適用後。冪等。
--
-- 使い方（SQL Editor）:
--   select promote_to_owner('you@example.com');
-- =============================================================

create or replace function promote_to_owner(target_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  select id into uid from auth.users where email = target_email;
  if uid is null then
    return format('対象ユーザーが見つかりません（auth.users に未登録）: %s', target_email);
  end if;

  if not exists (select 1 from profiles where id = uid) then
    return format('profiles に行がありません。先にアプリで新規登録してください: %s', target_email);
  end if;

  -- 保護トリガーを一時無効化 → 昇格 → 再有効化（失敗時はトランザクションごと巻き戻る）
  alter table profiles disable trigger trg_guard_profile_privileged;
  update profiles set role = 'owner' where id = uid;
  alter table profiles enable trigger trg_guard_profile_privileged;

  return format('オーナーに昇格しました: %s', target_email);
end;
$$;

-- 一般ロールからは呼べないようにする（自己昇格の穴を塞ぐ）
revoke all on function promote_to_owner(text) from public;
revoke all on function promote_to_owner(text) from anon;
revoke all on function promote_to_owner(text) from authenticated;

-- ----- 適用記録 ----------------------------------------------
insert into schema_migrations (version) values ('0005_promote_owner')
  on conflict (version) do nothing;
