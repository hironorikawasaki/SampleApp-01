"use client";

// =============================================================
// 従業員向け 希望シフト提出カレンダー
//   - 受付中(open)の提出期間を取得し、対象日をカレンダー表示
//   - 入れる日をタップ → 時間帯を「希望/勤務可能/NG」で追加
//   - 営業時間（config の openTime〜翌closeTime・日付跨ぎ）前提の時間選択
//   - カレンダーの日付 = その日に開店する営業日（夜）を指す
//   - 締切後・受付終了後は閲覧のみ
// 依存: @/lib/supabaseClient
// スキーマ: shift_periods / shift_preferences（v2）に対応
// =============================================================

import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { config } from "@/lib/config";
import {
  WEEKDAYS,
  TIME_SLOTS,
  timeLabel,
  hoursBetween,
  toKey,
  fromKey,
} from "@/lib/shiftTime";

// ---- 型 ------------------------------------------------------
type PeriodStatus = "open" | "closed" | "published";
type PreferenceType = "preferred" | "available" | "unavailable";

interface ShiftPeriod {
  id: string;
  title: string;
  start_date: string; // 'YYYY-MM-DD'
  end_date: string;
  submission_deadline: string; // ISO
  status: PeriodStatus;
}

interface Preference {
  id: string;
  period_id: string;
  employee_id: string;
  work_date: string; // 'YYYY-MM-DD'（開店日）
  start_time: string | null; // 'HH:MM' or 'HH:MM:SS'
  end_time: string | null;
  preference: PreferenceType;
  note: string | null;
}

// ---- 定番シフト（config で店舗別に上書き可）-------------------
const PRESETS = config.shiftPresets;

// ---- 希望種別の表示設定 --------------------------------------
const PREF_META: Record<
  PreferenceType,
  { label: string; dot: string; chip: string; ring: string }
> = {
  preferred: {
    label: "希望",
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    ring: "ring-emerald-500",
  },
  available: {
    label: "勤務可能",
    dot: "bg-sky-500",
    chip: "bg-sky-50 text-sky-700 border-sky-200",
    ring: "ring-sky-500",
  },
  unavailable: {
    label: "NG（休み希望）",
    dot: "bg-rose-500",
    chip: "bg-rose-50 text-rose-700 border-rose-200",
    ring: "ring-rose-500",
  },
};

export default function ShiftPreferenceCalendar() {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [period, setPeriod] = useState<ShiftPeriod | null>(null);
  const [prefs, setPrefs] = useState<Preference[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);

  const editable = useMemo(() => {
    if (!period || period.status !== "open") return false;
    return new Date(period.submission_deadline).getTime() > Date.now();
  }, [period]);

  // 所属店舗の読み込み（自分がメンバーの店舗のみ）
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
        const list = (mem ?? [])
          .map((m: any) => m.stores)
          .filter((s: any) => s && s.is_active)
          .map((s: any) => ({ id: s.id as string, name: s.name as string }));
        setStores(list);
        setStoreId(list[0]?.id ?? null);
        if (list.length === 0) setLoading(false);
      } catch (e: any) {
        setError(e?.message ?? "読み込みに失敗しました。");
        setLoading(false);
      }
    })();
  }, []);

  // 選択店舗の受付中期間＋自分の希望を読み込み
  useEffect(() => {
    if (!storeId || !userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: periods, error: pErr } = await supabase
          .from("shift_periods")
          .select("*")
          .eq("status", "open")
          .eq("store_id", storeId)
          .order("start_date", { ascending: true })
          .limit(1);
        if (pErr) throw pErr;
        const current = periods?.[0] ?? null;
        if (cancelled) return;
        setPeriod(current);
        setSelectedDate(null);
        if (current) {
          const { data: myPrefs, error: prefErr } = await supabase
            .from("shift_preferences")
            .select("*")
            .eq("period_id", current.id)
            .eq("employee_id", userId);
          if (prefErr) throw prefErr;
          if (!cancelled) setPrefs(myPrefs ?? []);
        } else {
          setPrefs([]);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "読み込みに失敗しました。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, userId]);

  const prefsByDate = useMemo(() => {
    const map = new Map<string, Preference[]>();
    for (const p of prefs) {
      const arr = map.get(p.work_date) ?? [];
      arr.push(p);
      map.set(p.work_date, arr);
    }
    return map;
  }, [prefs]);

  const weeks = useMemo(() => {
    if (!period) return [] as { key: string; inRange: boolean }[][];
    const start = fromKey(period.start_date);
    const end = fromKey(period.end_date);
    const gridStart = new Date(start);
    gridStart.setDate(start.getDate() - start.getDay());
    const gridEnd = new Date(end);
    gridEnd.setDate(end.getDate() + (6 - end.getDay()));

    const out: { key: string; inRange: boolean }[][] = [];
    const cur = new Date(gridStart);
    while (cur <= gridEnd) {
      const row: { key: string; inRange: boolean }[] = [];
      for (let i = 0; i < 7; i++) {
        const key = toKey(cur);
        const inRange = key >= period.start_date && key <= period.end_date;
        row.push({ key, inRange });
        cur.setDate(cur.getDate() + 1);
      }
      out.push(row);
    }
    return out;
  }, [period]);

  const addEntry = useCallback(
    async (payload: {
      preference: PreferenceType;
      start_time: string | null;
      end_time: string | null;
      note: string | null;
    }) => {
      if (!period || !userId || !selectedDate) return;
      const { data, error: insErr } = await supabase
        .from("shift_preferences")
        .insert({
          period_id: period.id,
          employee_id: userId,
          work_date: selectedDate,
          ...payload,
        })
        .select()
        .single();
      if (insErr) {
        setError(insErr.message);
        return;
      }
      if (data) setPrefs((prev) => [...prev, data as Preference]);
    },
    [period, userId, selectedDate]
  );

  const removeEntry = useCallback(async (id: string) => {
    const { error: delErr } = await supabase
      .from("shift_preferences")
      .delete()
      .eq("id", id);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    setPrefs((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // ---- 描画 --------------------------------------------------
  if (loading) {
    return (
      <div className="mx-auto max-w-md p-6 text-center text-slate-500">
        読み込み中…
      </div>
    );
  }

  if (error && !period) {
    return (
      <div className="mx-auto max-w-md p-6 text-center text-rose-600">
        {error}
      </div>
    );
  }

  if (!period) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        {stores.length === 0 ? (
          <>
            <p className="text-lg font-medium text-slate-800">
              所属している店舗がありません
            </p>
            <p className="mt-2 text-sm text-slate-500">
              オーナーに店舗への割り当てを依頼してください。
            </p>
          </>
        ) : (
          <>
            {stores.length > 1 && (
              <div className="mb-4 flex justify-center">
                <select
                  value={storeId ?? ""}
                  onChange={(e) => setStoreId(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-lg font-medium text-slate-800">
              いま受付中の期間はありません
            </p>
            <p className="mt-2 text-sm text-slate-500">
              次の募集が始まると、ここに表示されます。
            </p>
          </>
        )}
      </div>
    );
  }

  const deadline = new Date(period.submission_deadline);
  const monthLabel = (() => {
    const d = fromKey(period.start_date);
    return `${d.getFullYear()}年${d.getMonth() + 1}月`;
  })();

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-5">
      {/* ヘッダー */}
      <header className="mb-4">
        {stores.length > 1 && (
          <select
            value={storeId ?? ""}
            onChange={(e) => setStoreId(e.target.value)}
            className="mb-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <p className="text-xs font-medium tracking-wide text-slate-400">
          {monthLabel}
        </p>
        <h1 className="mt-0.5 text-xl font-bold text-slate-900">
          {period.title} の希望シフト
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          営業 {config.openTime}〜翌{config.closeTime}
          。入れる日（開店日）をタップして時間帯を登録してください。
        </p>
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
            editable
              ? "border-slate-200 bg-slate-50 text-slate-600"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          {editable ? (
            <>
              締切：{deadline.getMonth() + 1}/{deadline.getDate()}{" "}
              {String(deadline.getHours()).padStart(2, "0")}:
              {String(deadline.getMinutes()).padStart(2, "0")} まで
            </>
          ) : (
            <>受付は終了しました。内容の閲覧のみできます。</>
          )}
        </div>
      </header>

      {/* 凡例 */}
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600">
        {(Object.keys(PREF_META) as PreferenceType[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${PREF_META[k].dot}`} />
            {PREF_META[k].label}
          </span>
        ))}
      </div>

      {/* 曜日見出し */}
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-400">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={i === 0 ? "text-rose-400" : i === 6 ? "text-sky-400" : ""}
          >
            {w}
          </div>
        ))}
      </div>

      {/* カレンダー本体 */}
      <div className="mt-1 grid grid-cols-7 gap-1">
        {weeks.flat().map(({ key, inRange }) => {
          const dayNum = fromKey(key).getDate();
          const entries = prefsByDate.get(key) ?? [];
          const has = entries.length > 0;
          if (!inRange) {
            return <div key={key} className="aspect-square" aria-hidden />;
          }
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedDate(key)}
              className={`flex aspect-square flex-col items-center justify-start rounded-xl border p-1 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
                has
                  ? "border-slate-300 bg-white font-semibold text-slate-900 shadow-sm"
                  : "border-slate-100 bg-slate-50 text-slate-500 hover:border-slate-300"
              }`}
            >
              <span className="mt-0.5">{dayNum}</span>
              {has && (
                <span className="mt-auto mb-0.5 flex gap-0.5">
                  {Array.from(new Set(entries.map((e) => e.preference))).map(
                    (t) => (
                      <span
                        key={t}
                        className={`h-1.5 w-1.5 rounded-full ${PREF_META[t].dot}`}
                      />
                    )
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="mt-3 text-center text-sm text-rose-600">{error}</p>
      )}

      {/* 日別の編集シート */}
      {selectedDate && (
        <DaySheet
          dateKey={selectedDate}
          entries={prefsByDate.get(selectedDate) ?? []}
          editable={editable}
          onClose={() => setSelectedDate(null)}
          onAdd={addEntry}
          onRemove={removeEntry}
        />
      )}
    </div>
  );
}

// =============================================================
// 日別の編集シート
// =============================================================
function DaySheet({
  dateKey,
  entries,
  editable,
  onClose,
  onAdd,
  onRemove,
}: {
  dateKey: string;
  entries: Preference[];
  editable: boolean;
  onClose: () => void;
  onAdd: (p: {
    preference: PreferenceType;
    start_time: string | null;
    end_time: string | null;
    note: string | null;
  }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const d = fromKey(dateKey);
  const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日(${
    WEEKDAYS[d.getDay()]
  })`;

  const [pref, setPref] = useState<PreferenceType>("preferred");
  const [start, setStart] = useState(config.openTime);
  const [end, setEnd] = useState("00:00");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const isNG = pref === "unavailable";

  // 開始を変えたら、終了が開始以前にならないよう補正
  function handleStart(v: string) {
    setStart(v);
    const si = TIME_SLOTS.indexOf(v);
    const ei = TIME_SLOTS.indexOf(end);
    if (ei <= si) setEnd(TIME_SLOTS[Math.min(si + 1, TIME_SLOTS.length - 1)]);
  }

  // 定番ボタン：開始・終了をまとめてセット
  function applyPreset(p: { start: string; end: string }) {
    setStart(p.start);
    setEnd(p.end);
  }

  const startIdx = TIME_SLOTS.indexOf(start);

  async function handleAdd() {
    setSaving(true);
    await onAdd({
      preference: pref,
      start_time: isNG ? null : start,
      end_time: isNG ? null : end,
      note: note.trim() || null,
    });
    setNote("");
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">{dateLabel}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-400">
          この日の{config.openTime}開店ぶん（翌{config.closeTime}まで）の営業日です。
        </p>

        {/* 登録済みの希望 */}
        {entries.length > 0 ? (
          <ul className="mb-4 space-y-2">
            {entries.map((e) => (
              <li
                key={e.id}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                  PREF_META[e.preference].chip
                }`}
              >
                <span className="font-medium">
                  {PREF_META[e.preference].label}
                  {e.start_time && (
                    <span className="ml-2 font-normal">
                      {timeLabel(e.start_time)}–{timeLabel(e.end_time)}
                      <span className="ml-1 text-xs text-slate-500">
                        （{hoursBetween(e.start_time, e.end_time ?? e.start_time)}h）
                      </span>
                    </span>
                  )}
                  {e.note && (
                    <span className="ml-2 font-normal text-slate-500">
                      / {e.note}
                    </span>
                  )}
                </span>
                {editable && (
                  <button
                    type="button"
                    onClick={() => onRemove(e.id)}
                    className="ml-2 shrink-0 rounded p-1 text-slate-400 hover:text-rose-600"
                    aria-label="削除"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-slate-400">
            この日の希望はまだありません。
          </p>
        )}

        {/* 追加フォーム（受付中のみ） */}
        {editable ? (
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="mb-3 grid grid-cols-3 gap-1.5">
              {(Object.keys(PREF_META) as PreferenceType[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPref(k)}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${
                    pref === k
                      ? `${PREF_META[k].chip} ring-2 ${PREF_META[k].ring}`
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {PREF_META[k].label}
                </button>
              ))}
            </div>

            {!isNG && (
              <>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => {
                    const active = start === p.start && end === p.end;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => applyPreset(p)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                          active
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mb-2 flex items-center gap-2">
                  <select
                    value={start}
                    onChange={(e) => handleStart(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
                  >
                    {TIME_SLOTS.slice(0, -1).map((t) => (
                      <option key={t} value={t}>
                        {timeLabel(t)}
                      </option>
                    ))}
                  </select>
                  <span className="text-slate-400">–</span>
                  <select
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
                  >
                    {TIME_SLOTS.filter((_, i) => i > startIdx).map((t) => (
                      <option key={t} value={t}>
                        {timeLabel(t)}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="mb-3 text-xs text-slate-500">
                  勤務時間：{hoursBetween(start, end)} 時間
                </p>
              </>
            )}

            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="ひとこと（任意）"
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />

            <button
              type="button"
              onClick={handleAdd}
              disabled={saving}
              className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? "追加中…" : "追加する"}
            </button>
          </div>
        ) : (
          <p className="text-center text-sm text-slate-400">
            受付が終了しているため編集できません。
          </p>
        )}
      </div>
    </div>
  );
}
