"use client";

// =============================================================
// 従業員向け 確定シフト閲覧画面
//   - 公開済み(published)の期間のみ対象
//   - ログイン中の従業員自身の確定シフトを日付順に表示
//   - 「次の出勤」を強調 + 期間の合計時間
// 依存: @/lib/supabaseClient
// スキーマ: shift_periods / confirmed_shifts / profiles
// =============================================================

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  timeLabel,
  hoursBetween,
  todayKey,
  fromKey,
  fullDate,
  relativeDay,
  clockLabel,
} from "@/lib/shiftTime";
import ShiftCalendar, { type CalendarShift } from "@/components/ShiftCalendar";
import { roundedClockedHours } from "@/lib/hours";

interface ShiftPeriod {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  status: "open" | "closed" | "published";
  store_id: string;
}
interface Confirmed {
  id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  position: string | null;
  note: string | null;
}

export default function MyScheduleView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periods, setPeriods] = useState<ShiftPeriod[]>([]);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Confirmed[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [calShifts, setCalShifts] = useState<CalendarShift[]>([]);
  const [calNames, setCalNames] = useState<Map<string, string>>(new Map());
  const [calDayNotes, setCalDayNotes] = useState<Record<string, string>>({});
  const [attendance, setAttendance] = useState<
    { work_date: string; clock_in: string; clock_out: string | null }[]
  >([]);

  // 公開済み期間の取得（現在を含む期間を既定に）
  useEffect(() => {
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user ?? null;
        if (!user) {
          setError("ログインが必要です。");
          return;
        }
        setUserId(user.id);

        const [{ data: mem }, { data: ps, error: e }] = await Promise.all([
          supabase
            .from("store_members")
            .select("stores(id,name,is_active)")
            .eq("employee_id", user.id),
          supabase
            .from("shift_periods")
            .select("id,title,start_date,end_date,status,store_id")
            .eq("status", "published")
            .order("start_date", { ascending: false }),
        ]);
        if (e) throw e;

        const list = (mem ?? [])
          .map((m: any) => m.stores)
          .filter((s: any) => s && s.is_active)
          .map((s: any) => ({ id: s.id as string, name: s.name as string }));
        setStores(list);
        const firstStore = list[0]?.id ?? null;
        setStoreId(firstStore);
        setPeriods(ps ?? []);
        const tk = todayKey();
        const inStore = (ps ?? []).filter((p) => p.store_id === firstStore);
        const current =
          inStore.find((p) => p.start_date <= tk && tk <= p.end_date) ??
          inStore[0];
        setPeriodId(current?.id ?? null);
      } catch (e: any) {
        setError(e?.message ?? "読み込みに失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 選択期間の自分のシフトを取得
  useEffect(() => {
    if (!periodId || !userId) return;
    (async () => {
      const { data, error: e } = await supabase
        .from("confirmed_shifts")
        .select("id,work_date,start_time,end_time,position,note")
        .eq("period_id", periodId)
        .eq("employee_id", userId)
        .order("work_date", { ascending: true })
        .order("start_time", { ascending: true });
      if (e) setError(e.message);
      else setShifts(data ?? []);
    })();
  }, [periodId, userId]);

  // カレンダー用：選択店舗の公開済みシフト（同僚含む）＋氏名＋日別備考
  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    (async () => {
      const [{ data: cf }, { data: nm }, { data: notes }] = await Promise.all([
        supabase
          .from("confirmed_shifts")
          .select(
            "work_date,employee_id,start_time,end_time,position,shift_periods!inner(store_id,status)"
          )
          .eq("shift_periods.store_id", storeId)
          .eq("shift_periods.status", "published"),
        supabase.from("coworker_profiles").select("id,full_name"),
        supabase
          .from("day_notes")
          .select("work_date,note")
          .eq("store_id", storeId),
      ]);
      if (cancelled) return;
      setCalShifts(
        (cf ?? []).map((r: any) => ({
          work_date: r.work_date,
          employee_id: r.employee_id,
          start_time: r.start_time,
          end_time: r.end_time,
          position: r.position,
        }))
      );
      setCalNames(new Map((nm ?? []).map((p: any) => [p.id, p.full_name])));
      const noteMap: Record<string, string> = {};
      for (const n of notes ?? []) noteMap[n.work_date] = n.note;
      setCalDayNotes(noteMap);
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  // 本人の実績打刻（選択店舗）を読み込む
  useEffect(() => {
    if (!userId || !storeId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("attendance_records")
        .select("work_date,clock_in,clock_out")
        .eq("employee_id", userId)
        .eq("store_id", storeId);
      if (!cancelled) setAttendance(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, storeId]);

  const period = useMemo(
    () => periods.find((p) => p.id === periodId) ?? null,
    [periods, periodId]
  );
  const storePeriods = useMemo(
    () => periods.filter((p) => p.store_id === storeId),
    [periods, storeId]
  );

  function changeStore(sid: string) {
    setStoreId(sid);
    const tk = todayKey();
    const inStore = periods.filter((p) => p.store_id === sid);
    const current =
      inStore.find((p) => p.start_date <= tk && tk <= p.end_date) ?? inStore[0];
    setPeriodId(current?.id ?? null);
  }

  const totalHours = useMemo(
    () =>
      Math.round(
        shifts.reduce((s, c) => s + hoursBetween(c.start_time, c.end_time), 0) * 10
      ) / 10,
    [shifts]
  );

  // 実績（打刻ベース）：選択期間の合計と今月の合計
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const periodActual = useMemo(() => {
    if (!period) return 0;
    return round1(
      attendance
        .filter(
          (a) => a.work_date >= period.start_date && a.work_date <= period.end_date
        )
        .reduce((s, a) => s + roundedClockedHours(a.clock_in, a.clock_out), 0)
    );
  }, [attendance, period]);
  const currentYm = todayKey().slice(0, 7);
  const monthActual = useMemo(
    () =>
      round1(
        attendance
          .filter((a) => a.work_date.slice(0, 7) === currentYm)
          .reduce((s, a) => s + roundedClockedHours(a.clock_in, a.clock_out), 0)
      ),
    [attendance, currentYm]
  );

  const tk = todayKey();
  const nextShift = useMemo(
    () => shifts.find((s) => s.work_date >= tk) ?? null,
    [shifts, tk]
  );

  // 日付ごとに「予定（確定シフト）」と「実績（打刻）」をまとめる
  const daysView = useMemo(() => {
    const plan = new Map<string, Confirmed[]>();
    shifts.forEach((s) => {
      const a = plan.get(s.work_date) ?? [];
      a.push(s);
      plan.set(s.work_date, a);
    });
    const act = new Map<string, typeof attendance>();
    attendance.forEach((a) => {
      if (period && (a.work_date < period.start_date || a.work_date > period.end_date))
        return;
      const arr = act.get(a.work_date) ?? [];
      arr.push(a);
      act.set(a.work_date, arr);
    });
    const dates = new Set<string>([...plan.keys(), ...act.keys()]);
    return [...dates]
      .sort()
      .map((date) => ({
        date,
        planned: (plan.get(date) ?? [])
          .slice()
          .sort((a, b) => a.start_time.localeCompare(b.start_time)),
        actual: (act.get(date) ?? [])
          .slice()
          .sort((a, b) => a.clock_in.localeCompare(b.clock_in)),
      }));
  }, [shifts, attendance, period]);

  // ---- 描画 --------------------------------------------------
  if (loading)
    return (
      <div className="mx-auto max-w-md p-6 text-center text-slate-500">
        読み込み中…
      </div>
    );
  if (error)
    return (
      <div className="mx-auto max-w-md p-6 text-center text-rose-600">
        {error}
      </div>
    );

  if (periods.length === 0)
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="text-lg font-medium text-slate-800">
          公開されたシフトはまだありません
        </p>
        <p className="mt-2 text-sm text-slate-500">
          シフトが確定・公開されると、ここに表示されます。
        </p>
      </div>
    );

  return (
    <div className="mx-auto max-w-md px-4 pb-12 pt-5">
      {/* ヘッダー */}
      <header className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-slate-900">あなたのシフト</h1>
          <div className="flex items-center gap-2">
            {stores.length > 1 && (
              <select
                value={storeId ?? ""}
                onChange={(e) => changeStore(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            {storePeriods.length > 1 && (
              <select
                value={periodId ?? ""}
                onChange={(e) => setPeriodId(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
              >
                {storePeriods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        {period && view === "list" && (
          <p className="mt-1 text-sm text-slate-500">
            {period.title}（{period.start_date}〜{period.end_date}）・ 合計{" "}
            <span className="font-semibold text-slate-700">{totalHours}h</span>
          </p>
        )}
        <div className="mt-2 flex w-fit rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
          {(
            [
              ["list", "リスト"],
              ["calendar", "カレンダー"],
            ] as ["list" | "calendar", string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setView(m)}
              className={`rounded-md px-3 py-1 transition ${
                view === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* 実績（打刻ベース）の合計 */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          <p className="text-[11px] text-slate-400">実績（この期間）</p>
          <p className="text-lg font-bold text-slate-900">
            {periodActual}
            <span className="ml-0.5 text-xs font-normal text-slate-400">h</span>
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          <p className="text-[11px] text-slate-400">
            実績（今月 {Number(currentYm.slice(5, 7))}月）
          </p>
          <p className="text-lg font-bold text-slate-900">
            {monthActual}
            <span className="ml-0.5 text-xs font-normal text-slate-400">h</span>
          </p>
        </div>
      </div>

      {view === "calendar" ? (
        <ShiftCalendar
          shifts={calShifts}
          nameOf={(id) => calNames.get(id) ?? "同僚"}
          dayNotes={calDayNotes}
          highlightEmployeeId={userId ?? undefined}
        />
      ) : (
        <>
      {/* 次の出勤 */}
      {nextShift && (
        <div className="mb-5 rounded-2xl bg-slate-900 p-4 text-white">
          <p className="text-xs font-medium text-slate-300">次の出勤</p>
          <p className="mt-1 text-lg font-bold">
            {relativeDay(nextShift.work_date) ?? fullDate(nextShift.work_date)}
            <span className="ml-2 text-sm font-normal text-slate-300">
              {relativeDay(nextShift.work_date)
                ? fullDate(nextShift.work_date)
                : ""}
            </span>
          </p>
          <p className="mt-0.5 text-base">
            {timeLabel(nextShift.start_time)}–{timeLabel(nextShift.end_time)}
            <span className="ml-2 text-sm text-slate-300">
              （{hoursBetween(nextShift.start_time, nextShift.end_time)}h）
            </span>
            {nextShift.position && (
              <span className="ml-2 rounded-full bg-white/15 px-2 py-0.5 text-xs">
                {nextShift.position}
              </span>
            )}
          </p>
        </div>
      )}

      {/* 全日程（予定＝確定シフト／実績＝打刻 を縦に並べる） */}
      {daysView.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
          この期間にあなたのシフトはありません。
        </p>
      ) : (
        <ul className="space-y-2">
          {daysView.map(({ date, planned, actual }) => {
            const past = date < tk;
            const isToday = date === tk;
            const r1 = (n: number) => Math.round(n * 10) / 10;
            const plannedHours = r1(
              planned.reduce(
                (s, p) => s + hoursBetween(p.start_time, p.end_time),
                0
              )
            );
            const actualHours = r1(
              actual.reduce(
                (s, a) => s + roundedClockedHours(a.clock_in, a.clock_out),
                0
              )
            );
            const actualComplete = actual.some((a) => a.clock_out);
            const missing = past && planned.length > 0 && actual.length === 0;
            const unplanned = planned.length === 0 && actual.length > 0;
            const diff =
              actualComplete && planned.length > 0
                ? r1(actualHours - plannedHours)
                : null;
            let chip: { t: string; c: string } | null = null;
            if (diff !== null) {
              if (Math.abs(diff) < 0.25)
                chip = { t: "予定どおり", c: "bg-emerald-100 text-emerald-700" };
              else if (diff > 0)
                chip = { t: `実績 +${diff}h`, c: "bg-amber-100 text-amber-800" };
              else chip = { t: `実績 ${diff}h`, c: "bg-rose-100 text-rose-700" };
            } else if (missing)
              chip = { t: "未打刻", c: "bg-rose-100 text-rose-700" };
            else if (unplanned)
              chip = { t: "予定外", c: "bg-amber-100 text-amber-800" };
            return (
              <li
                key={date}
                className={`rounded-xl border px-4 py-3 ${
                  isToday
                    ? "border-slate-900 bg-white"
                    : missing
                    ? "border-rose-200 bg-rose-50/40"
                    : past
                    ? "border-slate-100 bg-slate-50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800">
                    {fullDate(date)}
                    {isToday && (
                      <span className="ml-2 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-white">
                        今日
                      </span>
                    )}
                  </span>
                  {chip && (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.c}`}
                    >
                      {chip.t}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 space-y-1">
                  {/* 予定 */}
                  {planned.length > 0
                    ? planned.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center gap-2 text-sm text-slate-700"
                        >
                          <span className="w-9 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-center text-[10px] font-medium text-slate-500">
                            予定
                          </span>
                          <span className="font-medium">
                            {timeLabel(s.start_time)}–{timeLabel(s.end_time)}
                          </span>
                          <span className="text-xs text-slate-400">
                            {hoursBetween(s.start_time, s.end_time)}h
                          </span>
                          {s.position && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                              {s.position}
                            </span>
                          )}
                        </div>
                      ))
                    : actual.length > 0 && (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="w-9 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-center text-[10px] font-medium text-slate-500">
                            予定
                          </span>
                          <span className="font-medium text-amber-700">なし</span>
                        </div>
                      )}
                  {/* 実績 */}
                  {actual.length > 0 ? (
                    actual.map((a, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-sm text-slate-700"
                      >
                        <span className="w-9 shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-center text-[10px] font-medium text-emerald-700">
                          実績
                        </span>
                        <span className="font-medium">
                          {clockLabel(a.clock_in)}–
                          {a.clock_out ? clockLabel(a.clock_out) : "勤務中"}
                        </span>
                        {a.clock_out && (
                          <span className="text-xs text-slate-400">
                            {roundedClockedHours(a.clock_in, a.clock_out)}h
                          </span>
                        )}
                      </div>
                    ))
                  ) : past && planned.length > 0 ? (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="w-9 shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-center text-[10px] font-medium text-rose-700">
                        実績
                      </span>
                      <span className="font-medium text-rose-600">未打刻</span>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
        </>
      )}
    </div>
  );
}
