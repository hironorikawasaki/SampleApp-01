"use client";

// =============================================================
// オーナー向け カレンダー（店舗のシフトを俯瞰）
//   - 店舗を選び、確定シフトをカレンダー表示
//   - 各日に出勤人数、日をタップで出勤一覧、日別備考を表示
// 依存: @/lib/supabaseClient, @/components/ShiftCalendar
// =============================================================

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import ShiftCalendar, { type CalendarShift } from "@/components/ShiftCalendar";

interface Store {
  id: string;
  name: string;
}

export default function OwnerCalendar() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [shifts, setShifts] = useState<CalendarShift[]>([]);
  const [dayNotes, setDayNotes] = useState<Record<string, string>>({});

  // 店舗・氏名の初期ロード
  useEffect(() => {
    (async () => {
      try {
        const [{ data: sts, error: e1 }, { data: profs, error: e2 }] =
          await Promise.all([
            supabase
              .from("stores")
              .select("id,name,is_active")
              .order("created_at", { ascending: true }),
            supabase.from("profiles").select("id,full_name"),
          ]);
        if (e1) throw e1;
        if (e2) throw e2;
        const active = (sts ?? []).filter((s) => s.is_active);
        setStores(active);
        setStoreId(active[0]?.id ?? null);
        setNames(new Map((profs ?? []).map((p) => [p.id, p.full_name])));
      } catch (e: any) {
        setError(e?.message ?? "読み込みに失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 選択店舗の確定シフト＋日別備考
  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    (async () => {
      const [{ data: cf }, { data: notes }] = await Promise.all([
        supabase
          .from("confirmed_shifts")
          .select(
            "work_date,employee_id,start_time,end_time,position,shift_periods!inner(store_id)"
          )
          .eq("shift_periods.store_id", storeId),
        supabase
          .from("day_notes")
          .select("work_date,note")
          .eq("store_id", storeId),
      ]);
      if (cancelled) return;
      setShifts(
        (cf ?? []).map((r: any) => ({
          work_date: r.work_date,
          employee_id: r.employee_id,
          start_time: r.start_time,
          end_time: r.end_time,
          position: r.position,
        }))
      );
      const noteMap: Record<string, string> = {};
      for (const n of notes ?? []) noteMap[n.work_date] = n.note;
      setDayNotes(noteMap);
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const nameOf = useMemo(
    () => (id: string) => names.get(id) ?? "不明",
    [names]
  );

  if (loading)
    return <div className="p-8 text-center text-slate-500">読み込み中…</div>;
  if (error)
    return <div className="p-8 text-center text-rose-600">{error}</div>;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">カレンダー</h1>
        {stores.length > 0 && (
          <select
            value={storeId ?? ""}
            onChange={(e) => setStoreId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </header>

      {stores.length === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
          店舗がありません。「店舗管理」で作成してください。
        </p>
      ) : (
        <ShiftCalendar shifts={shifts} nameOf={nameOf} dayNotes={dayNotes} />
      )}
    </div>
  );
}
