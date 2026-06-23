// app/(app)/(owner)/layout.tsx
// オーナー専用ページ（/schedule・/calendar・/timecards・/kiosk・/employees・
// /stores など (owner) 配下すべて）のサーバー側ガード。
// RLS でデータは保護されるが、非オーナーが画面の枠だけ開けてしまうのを防ぐため、
// サーバー側で役割を確認し、従業員は希望提出画面へリダイレクトする。
// （(owner) はルートグループなので URL パスには影響しない）
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // (app) レイアウトと同一リクエストなら getAuthContext は cache 済みで再実行されない
  const { user, role } = await getAuthContext();
  if (!user) redirect("/login");
  if (role !== "owner") redirect("/availability");

  return <>{children}</>;
}
