// app/page.tsx
// トップ "/" に来たユーザーを役割で振り分けるサーバーコンポーネント。
// （未ログインはmiddlewareで弾かれる前提だが、念のため再チェック）
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";

export default async function Home() {
  const { user, role } = await getAuthContext();
  if (!user) redirect("/login");
  redirect(role === "owner" ? "/schedule" : "/availability");
}
