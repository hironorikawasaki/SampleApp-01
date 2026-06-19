// app/(app)/(owner)/layout.tsx
// オーナー専用ページ（/schedule・/employees・/stores）のサーバー側ガード。
// RLS でデータは保護されるが、非オーナーが画面の枠だけ開けてしまうのを防ぐため、
// サーバー側で役割を確認し、従業員は希望提出画面へリダイレクトする。
// （(owner) はルートグループなので URL パスには影響しない）
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabaseServer";

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

  if (profile?.role !== "owner") redirect("/availability");

  return <>{children}</>;
}
