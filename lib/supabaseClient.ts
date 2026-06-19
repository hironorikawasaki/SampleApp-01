// lib/supabaseClient.ts
// Cookie対応のブラウザ用クライアント（@supabase/ssr）。
// 既存コンポーネントは import { supabase } のまま利用できます。
// 事前に: npm install @supabase/ssr
import { createBrowserClient } from "@supabase/ssr";

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  // ↑ 新しいSupabaseプロジェクトでは anon キーの代わりに
  //   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY（sb_publishable_...）を使う場合があります。
);
