-- =============================================================
-- 指定メールアドレスのユーザーを安全に「オーナー」へ昇格する管理関数
--   - 最初のオーナーを作る（ブートストラップ）用途。
--   - profiles_admin.sql の特権カラム保護トリガー
--     （trg_guard_profile_privileged）は、auth.uid() が無い文脈
--     （SQL Editor 等）では role 変更を巻き戻す。この関数は
--     トリガーを一時無効化して更新するため、確実に昇格できる。
--
-- 使い方（Supabase の SQL Editor）:
--   1) このファイル全体を一度だけ実行して関数を作成。
--   2) 次を実行:  select promote_to_owner('you@example.com');
--   3) アプリでログアウト→再ログインするとオーナーとして入れる。
--
-- 安全性:
--   - SECURITY DEFINER（テーブル所有者=postgres 権限で実行）。
--   - PUBLIC / anon / authenticated からは EXECUTE 権限を剥奪するので、
--     アプリのAPI経由（一般ユーザー）からは呼び出せない。
--     SQL Editor（postgres）/ service_role のみ実行可能。
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
  -- 対象ユーザーを特定
  select id into uid from auth.users where email = target_email;
  if uid is null then
    return format('対象ユーザーが見つかりません（auth.users に未登録）: %s', target_email);
  end if;

  -- profiles 行が無ければ（通常はトリガーで自動作成されるが念のため）作る
  if not exists (select 1 from profiles where id = uid) then
    return format('profiles に行がありません。先にアプリで新規登録してください: %s', target_email);
  end if;

  -- 保護トリガーを一時無効化 → 昇格 → 再有効化
  -- （いずれかで失敗してもトランザクションごとロールバックされ、
  --   DISABLE も巻き戻るため、トリガーが無効のまま残ることはない）
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
