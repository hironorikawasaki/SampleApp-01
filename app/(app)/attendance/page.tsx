"use client";

// =============================================================
// 従業員向け 出退勤の打刻
//   - 「出勤」「退勤」をタップして実労働時間を記録（給与計算の基礎）
//   - 営業日(開店日)は打刻時刻から自動判定（深夜は前日扱い）
//   - 最近の打刻履歴を表示。退勤後の修正はオーナーが行う
//   - v1 は休憩管理なし
// 依存: @/lib/supabaseClient, @/lib/shiftTime, @/lib/hours
// スキーマ: attendance_records / stores / store_members（0006_attendance）
// =============================================================

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { businessDayKey, clockLabel, fullDate } from "@/lib/shiftTime";
import { clockedHours } from "@/lib/hours";

interface AttendanceRecord {
  id: string;
  store_id: string;
  work_date: string;
  clock_in: string;
  clock_out: string | null;
  note: string | null;
}

export default function AttendanceClock() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // 所属店舗の読み込み
  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setError("ログインが必要です。");
          setLoading(false);
          return;
        }
        setUserId(user.id);
        const { data: mem, error: mErr } = await supabase
          .from("store_members")
          .select("stores(id,name,is_active)")
          .eq("employee_id", user.id);
        if (mErr) throw mErr;
        // 既存画面と同様、埋め込みリレーションは緩く扱う（生成型なしのため）
        const list = (mem ?? [])
          .map((m: any) => m.stores)
          .filter((s: any) => s && s.is_active)
          .map((s: any) => ({ id: s.id as string, name: s.name as string }));
        setStores(list);
        setStoreId(list[0]?.id ?? null);
        if (list.length === 0) setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "読み込みに失敗しました。");
        setLoading(false);
      }
    })();
  }, []);

  // 選択店舗の最近の打刻履歴
  useEffect(() => {
    if (!storeId || !userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error: e } = await supabase
        .from("attendance_records")
        .select("id, store_id, work_date, clock_in, clock_out, note")
        .eq("employee_id", userId)
        .eq("store_id", storeId)
        .order("clock_in", { ascending: false })
        .limit(60);
      if (!cancelled) {
        if (e) setError(e.message);
        else setRecords(data ?? []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, userId]);

  // 勤務中（退勤していない）の打刻。最新の1件。
  const openRecord = useMemo(
    () => records.find((r) => !r.clock_out) ?? null,
    [records]
  );

  async function clockIn() {
    if (!storeId || !userId || openRecord || submitting) return;
    setSubmitting(true);
    setError(null);
    const now = new Date();
    const { data, error: e } = await supabase
      .from("attendance_records")
      .insert({
        store_id: storeId,
        employee_id: userId,
        work_date: businessDayKey(now),
        clock_in: now.toISOString(),
      })
      .select("id, store_id, work_date, clock_in, clock_out, note")
      .single();
    setSubmitting(false);
    if (e) return setError(e.message);
    if (data) setRecords((prev) => [data as AttendanceRecord, ...prev]);
  }

  async function clockOut() {
    if (!openRecord || submitting) return;
    setSubmitting(true);
    setError(null);
    const nowIso = new Date().toISOString();
    const { error: e } = await supabase
      .from("attendance_records")
      .update({ clock_out: nowIso })
      .eq("id", openRecord.id);
    setSubmitting(false);
    if (e) return setError(e.message);
    setRecords((prev) =>
      prev.map((r) => (r.id === openRecord.id ? { ...r, clock_out: nowIso } : r))
    );
  }

  // 履歴を営業日でまとめる（新しい順）
  const byDate = useMemo(() => {
    const m = new Map<string, AttendanceRecord[]>();
    records.forEach((r) => {
      const a = m.get(r.work_date) ?? [];
      a.push(r);
      m.set(r.work_date, a);
    });
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [records]);

  if (loading) {
    return (
      <div className="mx-auto max-w-md p-6 text-center text-slate-500">
        読み込み中…
      </div>
    );
  }

  if (error && stores.length === 0) {
    return (
      <div className="mx-auto max-w-md p-6 text-center text-rose-600">
        {error}
      </div>
    );
  }

  if (stores.length === 0) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="text-lg font-medium text-slate-800">
          所属している店舗がありません
        </p>
        <p className="mt-2 text-sm text-slate-500">
          オーナーに店舗への割り当てを依頼してください。
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 pb-12 pt-5">
      <header className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900">出退勤</h1>
        {stores.length > 1 && (
          <select
            value={storeId ?? ""}
            onChange={(e) => setStoreId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </header>

      {/* 状態 + 打刻ボタン */}
      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
        {openRecord ? (
          <>
            <p className="text-sm text-slate-500">勤務中</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {clockLabel(openRecord.clock_in)} 出勤
            </p>
            <button
              type="button"
              onClick={clockOut}
              disabled={submitting}
              className="mt-4 w-full rounded-xl bg-rose-600 py-4 text-base font-bold text-white transition hover:bg-rose-700 disabled:opacity-50"
            >
              {submitting ? "処理中…" : "退勤する"}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-500">現在は勤務外です</p>
            <button
              type="button"
              onClick={clockIn}
              disabled={submitting}
              className="mt-4 w-full rounded-xl bg-emerald-600 py-4 text-base font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting ? "処理中…" : "出勤する"}
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="mb-3 text-center text-sm text-rose-600">{error}</p>
      )}

      {/* 履歴 */}
      <h2 className="mb-2 text-sm font-bold text-slate-700">最近の打刻</h2>
      {byDate.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
          まだ打刻はありません。
        </p>
      ) : (
        <ul className="space-y-2">
          {byDate.map(([date, items]) => {
            const dayTotal = items.reduce(
              (s, r) => s + clockedHours(r.clock_in, r.clock_out),
              0
            );
            return (
              <li
                key={date}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800">
                    {fullDate(date)}
                  </span>
                  <span className="text-xs text-slate-400">
                    計 {Math.round(dayTotal * 10) / 10}h
                  </span>
                </div>
                <div className="mt-1.5 space-y-1">
                  {items.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-2 text-sm text-slate-700"
                    >
                      <span className="font-medium">
                        {clockLabel(r.clock_in)}
                        {" – "}
                        {r.clock_out ? (
                          clockLabel(r.clock_out)
                        ) : (
                          <span className="text-emerald-600">勤務中</span>
                        )}
                      </span>
                      {r.clock_out && (
                        <span className="text-xs text-slate-400">
                          {clockedHours(r.clock_in, r.clock_out)}h
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
