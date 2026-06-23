"use client";

// =============================================================
// オーナー向け 勤怠管理（実績勤怠の確認・修正）
//   - 店舗・提出期間を選び、期間内の打刻を営業日ごとに一覧
//   - 打刻漏れ・誤りを修正（出勤/退勤の時刻）、手動追加、削除
//   - 従業員ごとの実労働時間（期間合計）を表示
//   - 給与計算（後フェーズ）の基礎データを整える画面
// 依存: @/lib/supabaseClient, @/lib/shiftTime, @/lib/hours
// スキーマ: attendance_records / shift_periods / profiles / stores / store_members
// =============================================================

import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  mdLabel,
  businessDayKey,
  isoToDatetimeLocal,
  datetimeLocalToIso,
} from "@/lib/shiftTime";
import { roundedClockedHours } from "@/lib/hours";
import CalendarPicker from "@/components/CalendarPicker";
import Link from "next/link";

interface Profile {
  id: string;
  full_name: string;
  role: "employee" | "owner";
  is_active: boolean;
}
interface ShiftPeriod {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  store_id: string;
}
interface Store {
  id: string;
  name: string;
  is_active: boolean;
}
interface AttendanceRecord {
  id: string;
  store_id: string;
  employee_id: string;
  work_date: string;
  clock_in: string;
  clock_out: string | null;
  note: string | null;
}

const memberKey = (empId: string, storeId: string) => `${empId}:${storeId}`;

export default function OwnerTimecards() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periods, setPeriods] = useState<ShiftPeriod[]>([]);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Set<string>>(new Set());
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // 期間を切り替えたら選択日をリセット
  useEffect(() => {
    setSelectedDate(null);
  }, [periodId]);

  const period = useMemo(
    () => periods.find((p) => p.id === periodId) ?? null,
    [periods, periodId]
  );
  const storePeriods = useMemo(
    () => periods.filter((p) => p.store_id === storeId),
    [periods, storeId]
  );
  const profilesById = useMemo(() => {
    const m = new Map<string, Profile>();
    profiles.forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles]);
  const activeEmployees = useMemo(
    () =>
      profiles.filter(
        (p) => p.is_active && memberships.has(memberKey(p.id, storeId ?? ""))
      ),
    [profiles, memberships, storeId]
  );

  // 初期ロード
  useEffect(() => {
    (async () => {
      try {
        const [
          { data: ps, error: e1 },
          { data: prof, error: e2 },
          { data: sts, error: e3 },
          { data: mem, error: e4 },
        ] = await Promise.all([
          supabase
            .from("shift_periods")
            .select("id,title,start_date,end_date,store_id")
            .order("start_date", { ascending: false }),
          supabase.from("profiles").select("id,full_name,role,is_active").order("full_name"),
          supabase.from("stores").select("id,name,is_active").order("created_at", { ascending: true }),
          supabase.from("store_members").select("store_id,employee_id"),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
        if (e3) throw e3;
        if (e4) throw e4;
        setPeriods(ps ?? []);
        setProfiles(prof ?? []);
        setStores(sts ?? []);
        setMemberships(
          new Set((mem ?? []).map((m) => memberKey(m.employee_id, m.store_id)))
        );
        const firstStore = (sts ?? [])[0]?.id ?? null;
        setStoreId(firstStore);
        const inStore = (ps ?? []).filter((p) => p.store_id === firstStore);
        setPeriodId(inStore[0]?.id ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "読み込みに失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 期間の打刻を読み込む
  useEffect(() => {
    if (!period || !storeId) {
      setRecords([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error: e } = await supabase
        .from("attendance_records")
        .select("id,store_id,employee_id,work_date,clock_in,clock_out,note")
        .eq("store_id", storeId)
        .gte("work_date", period.start_date)
        .lte("work_date", period.end_date)
        .order("clock_in", { ascending: true });
      if (!cancelled) {
        if (e) setError(e.message);
        else setRecords((data as AttendanceRecord[]) ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period, storeId]);

  function changeStore(sid: string) {
    setStoreId(sid);
    const inStore = periods.filter((p) => p.store_id === sid);
    setPeriodId(inStore[0]?.id ?? null);
  }

  // 楽観的更新（失敗時ロールバック）
  const updateRecord = useCallback(
    async (id: string, patch: Partial<AttendanceRecord>) => {
      let prev: AttendanceRecord[] = [];
      setRecords((cur) => {
        prev = cur;
        return cur.map((r) => (r.id === id ? { ...r, ...patch } : r));
      });
      const { error: e } = await supabase
        .from("attendance_records")
        .update(patch)
        .eq("id", id);
      if (e) {
        setRecords(prev);
        setError(e.message);
      }
    },
    []
  );

  const removeRecord = useCallback(async (id: string) => {
    let prev: AttendanceRecord[] = [];
    setRecords((cur) => {
      prev = cur;
      return cur.filter((r) => r.id !== id);
    });
    const { error: e } = await supabase
      .from("attendance_records")
      .delete()
      .eq("id", id);
    if (e) {
      setRecords(prev);
      setError(e.message);
    }
  }, []);

  const addRecord = useCallback(
    async (input: {
      employee_id: string;
      clock_in: string; // ISO
      clock_out: string | null; // ISO or null
    }) => {
      if (!storeId) return "店舗が選択されていません。";
      const { data, error: e } = await supabase
        .from("attendance_records")
        .insert({
          store_id: storeId,
          employee_id: input.employee_id,
          work_date: businessDayKey(new Date(input.clock_in)),
          clock_in: input.clock_in,
          clock_out: input.clock_out,
        })
        .select("id,store_id,employee_id,work_date,clock_in,clock_out,note")
        .single();
      if (e) return e.message;
      if (data) setRecords((prev) => [...prev, data as AttendanceRecord]);
      return null;
    },
    [storeId]
  );

  // 営業日ごとにまとめる（バッジ件数・選択日の打刻に使う）
  const recordsByDate = useMemo(() => {
    const m = new Map<string, AttendanceRecord[]>();
    records.forEach((r) => {
      const a = m.get(r.work_date) ?? [];
      a.push(r);
      m.set(r.work_date, a);
    });
    return m;
  }, [records]);

  // 従業員ごとの実労働時間（期間合計）
  const totalByEmployee = useMemo(() => {
    const m = new Map<string, number>();
    records.forEach((r) => {
      m.set(
        r.employee_id,
        Math.round(
          ((m.get(r.employee_id) ?? 0) +
            roundedClockedHours(r.clock_in, r.clock_out)) *
            10
        ) / 10
      );
    });
    return m;
  }, [records]);

  if (loading)
    return <div className="p-8 text-center text-slate-500">読み込み中…</div>;
  if (error && periods.length === 0)
    return <div className="p-8 text-center text-rose-600">{error}</div>;

  if (stores.length === 0)
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <h1 className="mb-1 text-2xl font-bold text-slate-900">勤怠管理</h1>
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
          まだ店舗がありません。先に「店舗管理」で店舗を作成してください。
        </p>
      </div>
    );

  const selectedDayRecords = selectedDate
    ? recordsByDate.get(selectedDate) ?? []
    : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-slate-900">勤怠管理</h1>
          <Link
            href="/kiosk"
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            店舗Padで打刻 →
          </Link>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={storeId ?? ""}
            onChange={(e) => changeStore(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={periodId ?? ""}
            onChange={(e) => setPeriodId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {storePeriods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}（{p.start_date}〜{p.end_date}）
              </option>
            ))}
          </select>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          実績の出退勤を確認・修正します。退勤時刻が空欄は「勤務中（未退勤）」です。
        </p>
      </header>

      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {!period ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
          この店舗にはまだ提出期間がありません。「シフト作成」で期間を作成してください。
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0">
            {/* 日付カレンダー（その日を選んで下で確認・修正） */}
            <CalendarPicker
              selected={selectedDate}
              onSelect={setSelectedDate}
              rangeStart={period.start_date}
              rangeEnd={period.end_date}
              badge={(key) => {
                const recs = recordsByDate.get(key) ?? [];
                if (recs.length === 0) return null;
                const names = [...new Set(recs.map((r) => r.employee_id))].map(
                  (id) => profilesById.get(id)?.full_name ?? "不明"
                );
                return (
                  <div className="space-y-px">
                    {names.slice(0, 4).map((nm, i) => (
                      <div
                        key={i}
                        className="truncate rounded bg-slate-100 px-1 text-[10px] leading-tight text-slate-600"
                      >
                        {nm}
                      </div>
                    ))}
                    {names.length > 4 && (
                      <div className="px-1 text-[10px] text-slate-400">
                        ＋{names.length - 4}人
                      </div>
                    )}
                  </div>
                );
              }}
            />

            {!selectedDate ? (
              <p className="mt-4 rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
                日付を選ぶと、その日の打刻を確認・修正・追加できます。
              </p>
            ) : (
              <div className="mt-4">
                <h2 className="mb-2 text-sm font-bold text-slate-700">
                  {mdLabel(selectedDate)} の打刻
                </h2>
                {/* 手動追加（選択日） */}
                <ManualAdd
                  key={selectedDate}
                  employees={activeEmployees}
                  defaultDate={selectedDate}
                  onAdd={addRecord}
                />
                {selectedDayRecords.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-400">
                    この日の打刻はありません。
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {selectedDayRecords.map((r) => (
                      <RecordRow
                        key={r.id}
                        row={r}
                        name={
                          profilesById.get(r.employee_id)?.full_name ?? "不明"
                        }
                        onUpdate={updateRecord}
                        onRemove={removeRecord}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* 実労働時間（期間合計） */}
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <h2 className="mb-2 text-sm font-bold text-slate-700">
              実労働時間（期間）
            </h2>
            <ul className="space-y-1.5">
              {activeEmployees
                .filter((e) => (totalByEmployee.get(e.id) ?? 0) > 0)
                .map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-1.5 text-sm"
                  >
                    <span className="truncate text-slate-700">{e.full_name}</span>
                    <span className="ml-2 shrink-0 font-medium text-slate-600">
                      {totalByEmployee.get(e.id) ?? 0}h
                    </span>
                  </li>
                ))}
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              15分丸め（出勤切上げ／退勤切捨て）で算出。休憩は未対応。給与計算は後フェーズで対応します。
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}

// 打刻1件（出勤/退勤の時刻を修正・削除）
function RecordRow({
  row,
  name,
  onUpdate,
  onRemove,
}: {
  row: AttendanceRecord;
  name: string;
  onUpdate: (id: string, patch: Partial<AttendanceRecord>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-800">{name}</span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-slate-400">
            {row.clock_out
              ? `${roundedClockedHours(row.clock_in, row.clock_out)}h`
              : "勤務中"}
          </span>
          <button
            type="button"
            onClick={() => onRemove(row.id)}
            className="rounded p-1 text-slate-400 hover:text-rose-600"
            aria-label="削除"
          >
            ✕
          </button>
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1 text-xs text-slate-500">
          出勤
          <input
            type="datetime-local"
            value={isoToDatetimeLocal(row.clock_in)}
            onChange={(e) => {
              if (e.target.value)
                onUpdate(row.id, { clock_in: datetimeLocalToIso(e.target.value) });
            }}
            className="rounded-md border border-slate-200 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          退勤
          <input
            type="datetime-local"
            value={row.clock_out ? isoToDatetimeLocal(row.clock_out) : ""}
            onChange={(e) =>
              onUpdate(row.id, {
                clock_out: e.target.value
                  ? datetimeLocalToIso(e.target.value)
                  : null,
              })
            }
            className="rounded-md border border-slate-200 px-2 py-1 text-sm"
          />
        </label>
      </div>
    </li>
  );
}

// 手動追加フォーム
function ManualAdd({
  employees,
  defaultDate,
  onAdd,
}: {
  employees: Profile[];
  defaultDate: string;
  onAdd: (input: {
    employee_id: string;
    clock_in: string;
    clock_out: string | null;
  }) => Promise<string | null>;
}) {
  // 既定の出勤時刻：期間開始日の 20:00（datetime-local 形式）
  const defaultIn = `${defaultDate}T20:00`;
  const [empId, setEmpId] = useState("");
  const [clockIn, setClockIn] = useState(defaultIn);
  const [clockOut, setClockOut] = useState("");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function add() {
    setLocalError(null);
    if (!empId) return setLocalError("従業員を選択してください。");
    if (!clockIn) return setLocalError("出勤時刻を入力してください。");
    if (clockOut && datetimeLocalToIso(clockOut) <= datetimeLocalToIso(clockIn))
      return setLocalError("退勤は出勤より後にしてください。");
    setSaving(true);
    const msg = await onAdd({
      employee_id: empId,
      clock_in: datetimeLocalToIso(clockIn),
      clock_out: clockOut ? datetimeLocalToIso(clockOut) : null,
    });
    setSaving(false);
    if (msg) setLocalError(msg);
    else {
      setEmpId("");
      setClockOut("");
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-3">
      <p className="mb-2 text-xs font-medium text-slate-500">打刻を手動で追加</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          value={empId}
          onChange={(e) => setEmpId(e.target.value)}
          className="rounded-md border border-slate-200 px-2 py-1"
        >
          <option value="">従業員を選択</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          出勤
          <input
            type="datetime-local"
            value={clockIn}
            onChange={(e) => setClockIn(e.target.value)}
            className="rounded-md border border-slate-200 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          退勤
          <input
            type="datetime-local"
            value={clockOut}
            onChange={(e) => setClockOut(e.target.value)}
            className="rounded-md border border-slate-200 px-2 py-1 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={add}
          disabled={saving}
          className="rounded-md bg-slate-900 px-3 py-1 font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {saving ? "追加中…" : "追加"}
        </button>
      </div>
      {localError && (
        <p className="mt-2 text-xs text-rose-600">{localError}</p>
      )}
    </div>
  );
}
