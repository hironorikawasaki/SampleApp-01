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

const OPEN_TIME = "20:00";

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

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function isNextDay(t: string) {
  return t.slice(0, 5) < OPEN_TIME;
}
function timeLabel(t: string) {
  const v = t.slice(0, 5);
  return (isNextDay(v) ? "翌" : "") + v;
}
function hoursBetween(start: string, end: string) {
  const toMin = (s: string) => {
    const [h, m] = s.slice(0, 5).split(":").map(Number);
    return h * 60 + m;
  };
  let diff = toMin(end) - toMin(start);
  if (diff <= 0) diff += 1440;
  return Math.round((diff / 60) * 10) / 10;
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
function fromKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fullDate(key: string) {
  const d = fromKey(key);
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`;
}
// 今日からの相対表現
function relativeDay(key: string) {
  const diff = Math.round(
    (fromKey(key).getTime() - fromKey(todayKey()).getTime()) / 86400000
  );
  if (diff === 0) return "今日";
  if (diff === 1) return "明日";
  if (diff === 2) return "明後日";
  return null;
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

  // 公開済み期間の取得（現在を含む期間を既定に）
  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
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

  const tk = todayKey();
  const nextShift = useMemo(
    () => shifts.find((s) => s.work_date >= tk) ?? null,
    [shifts, tk]
  );

  // 日付ごとにまとめる
  const byDate = useMemo(() => {
    const m = new Map<string, Confirmed[]>();
    shifts.forEach((s) => {
      const a = m.get(s.work_date) ?? [];
      a.push(s);
      m.set(s.work_date, a);
    });
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [shifts]);

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
        {period && (
          <p className="mt-1 text-sm text-slate-500">
            {period.title}（{period.start_date}〜{period.end_date}）・ 合計{" "}
            <span className="font-semibold text-slate-700">{totalHours}h</span>
          </p>
        )}
      </header>

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

      {/* 全日程 */}
      {byDate.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
          この期間にあなたのシフトはありません。
        </p>
      ) : (
        <ul className="space-y-2">
          {byDate.map(([date, items]) => {
            const past = date < tk;
            const isToday = date === tk;
            return (
              <li
                key={date}
                className={`rounded-xl border px-4 py-3 ${
                  isToday
                    ? "border-slate-900 bg-white"
                    : past
                    ? "border-slate-100 bg-slate-50 opacity-60"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800">
                    {fullDate(date)}
                    {isToday && (
                      <span className="ml-2 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-white">
                        今日
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-1.5 space-y-1">
                  {items.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-2 text-sm text-slate-700"
                    >
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
                      {s.note && (
                        <span className="text-xs text-slate-400">/ {s.note}</span>
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
