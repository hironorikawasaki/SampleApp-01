// app/api/push/send-reminders/route.ts
// 定期実行（cron）から呼ばれ、未提出の従業員へWebPushでリマインドを送る。
//  - 認証: Authorization: Bearer <CRON_SECRET>
//  - service_role で全件を読む（RLSバイパス）。
//  - 送信対象: status=open かつ 締切が「現在〜REMIND_WITHIN_HOURS 以内」で未提出。
//  - 410/404 の購読は無効として削除する。
import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabaseAdmin";
import { getWebPush } from "@/lib/webpush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 締切の何時間前から通知するか
const REMIND_WITHIN_HOURS = 72;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminSupabase();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMIND_WITHIN_HOURS * 3600 * 1000);

  // 1) 通知対象の提出期間（受付中・締切が通知ウィンドウ内）
  const { data: periods, error: e1 } = await supabase
    .from("shift_periods")
    .select("id, title, submission_deadline, store_id")
    .eq("status", "open")
    .gte("submission_deadline", now.toISOString())
    .lte("submission_deadline", windowEnd.toISOString());
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (!periods || periods.length === 0) {
    return NextResponse.json({ ok: true, periods: 0, sent: 0 });
  }
  const periodIds = periods.map((p) => p.id);

  // 2) 在籍中の従業員
  const { data: employees } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "employee")
    .eq("is_active", true);
  const employeeIds = (employees ?? []).map((e) => e.id);
  if (employeeIds.length === 0) {
    return NextResponse.json({ ok: true, periods: periods.length, sent: 0 });
  }

  // 3) 提出済み（period_id, employee_id）
  const { data: prefs } = await supabase
    .from("shift_preferences")
    .select("period_id, employee_id")
    .in("period_id", periodIds);
  const submitted = new Set(
    (prefs ?? []).map((p) => `${p.period_id}:${p.employee_id}`)
  );

  // 3b) 店舗所属（employee_id:store_id）。所属店舗の期間のみ対象にする。
  const { data: members } = await supabase
    .from("store_members")
    .select("store_id, employee_id");
  const memberOf = new Set(
    (members ?? []).map((m) => `${m.employee_id}:${m.store_id}`)
  );

  // 4) 従業員ごとの未提出期間タイトル（所属店舗かつ未提出のみ）
  const pendingByEmployee = new Map<string, string[]>();
  for (const empId of employeeIds) {
    const titles: string[] = [];
    for (const p of periods) {
      if (!memberOf.has(`${empId}:${p.store_id}`)) continue;
      if (!submitted.has(`${p.id}:${empId}`)) titles.push(p.title);
    }
    if (titles.length > 0) pendingByEmployee.set(empId, titles);
  }
  const targetIds = [...pendingByEmployee.keys()];
  if (targetIds.length === 0) {
    return NextResponse.json({ ok: true, periods: periods.length, sent: 0 });
  }

  // 5) 対象従業員の購読を取得
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, employee_id, endpoint, p256dh, auth")
    .in("employee_id", targetIds);
  if (!subs || subs.length === 0) {
    return NextResponse.json({ ok: true, periods: periods.length, sent: 0 });
  }

  // 6) 送信
  const webpush = getWebPush();
  let sent = 0;
  let removed = 0;
  const staleIds: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      const titles = pendingByEmployee.get(s.employee_id) ?? [];
      const label =
        titles.length === 1 ? `「${titles[0]}」` : `${titles.length}件の期間`;
      const payload = JSON.stringify({
        title: "シフト希望の提出をお忘れなく",
        body: `${label}が未提出です。締切が近づいています。`,
        url: "/availability",
      });
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          payload
        );
        sent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          staleIds.push(s.id);
        }
      }
    })
  );

  // 7) 無効な購読を掃除
  if (staleIds.length > 0) {
    const { error: delErr } = await supabase
      .from("push_subscriptions")
      .delete()
      .in("id", staleIds);
    if (!delErr) removed = staleIds.length;
  }

  return NextResponse.json({
    ok: true,
    periods: periods.length,
    targets: targetIds.length,
    subscriptions: subs.length,
    sent,
    removed,
  });
}
