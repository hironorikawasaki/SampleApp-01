// lib/auth.ts
// サーバー側の「認証＋役割」取得を1リクエスト内で1回に集約する。
// React の cache() により、ネストしたレイアウト（(app) → (owner)）やページから
// 何度呼んでも getUser／role クエリは1回だけ実行される（重複排除）。
import { cache } from "react";
import { createServerSupabase } from "@/lib/supabaseServer";

export type Role = "owner" | "employee";

export const getAuthContext = cache(async () => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, user: null, role: null as Role | null };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role: Role = profile?.role === "owner" ? "owner" : "employee";
  return { supabase, user, role };
});
