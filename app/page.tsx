// app/page.tsx
// トップ "/" に来たユーザーを役割で振り分けるサーバーコンポーネント。
// （未ログインはmiddlewareで弾かれる前提だが、念のため再チェック）
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabaseServer";

export default async function Home() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  redirect(profile?.role === "owner" ? "/schedule" : "/availability");
}
