// lib/supabaseAdmin.ts
// サーバー専用の管理クライアント（service_role）。RLS をバイパスするため、
// 認証コンテキストの無い処理（cron でのリマインド送信など）から全件を読む用途に使う。
//
// 重要:
//  - SUPABASE_SERVICE_ROLE_KEY は秘密鍵。NEXT_PUBLIC_ を付けず、サーバーだけで使う。
//  - クライアントコンポーネントや middleware からは絶対に import しないこと。
import { createClient } from "@supabase/supabase-js";

export function createAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL が未設定です。"
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
