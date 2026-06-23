// app/(app)/layout.tsx
// ログイン後ページの共通レイアウト。役割を取得してボトムナビを表示する。
// この (app) グループの下に置いたページ（availability / my-schedule / schedule）が
// 下タブを共有します。/login はこのグループの外に置く（ナビなし）。
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import AppNav from "@/components/AppNav";
import SubmissionReminder, {
  type ReminderPeriod,
} from "@/components/SubmissionReminder";
import PushToggle from "@/components/PushToggle";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, user, role } = await getAuthContext();
  if (!user) redirect("/login");

  // 従業員のみ：受付中・締切前で未提出の期間をリマインド対象として算出
  let reminders: ReminderPeriod[] = [];
  if (role === "employee") {
    const nowIso = new Date().toISOString();
    const { data: openPeriods } = await supabase
      .from("shift_periods")
      .select("id, title, submission_deadline")
      .eq("status", "open")
      .gte("submission_deadline", nowIso)
      .order("submission_deadline", { ascending: true });

    if (openPeriods && openPeriods.length > 0) {
      const ids = openPeriods.map((p) => p.id);
      const { data: myPrefs } = await supabase
        .from("shift_preferences")
        .select("period_id")
        .eq("employee_id", user.id)
        .in("period_id", ids);
      const submitted = new Set((myPrefs ?? []).map((p) => p.period_id));
      reminders = openPeriods.filter((p) => !submitted.has(p.id));
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {/* 下タブ分の余白を確保 */}
      <main className="pb-20">
        {role === "employee" && <PushToggle />}
        <SubmissionReminder periods={reminders} />
        {children}
      </main>
      <AppNav role={role} />
    </div>
  );
}
