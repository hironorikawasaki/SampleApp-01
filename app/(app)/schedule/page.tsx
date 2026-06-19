"use client";

// =============================================================
// オーナー向け 確定シフト作成画面
//   - 提出期間を選択 → 日ごとに全員の希望を一覧
//   - 希望をワンタップで確定シフトへ / 時間・担当を調整 / 手動追加
//   - 各従業員の確定合計時間を月上限と比較（非正規の上限管理）
//   - 受付締切・公開のステータス操作
// 依存: @/lib/supabaseClient
// スキーマ: shift_periods / shift_preferences / confirmed_shifts / profiles
// 時間ロジックは従業員側コンポーネントと同一（lib に切り出すと共通化可）
// =============================================================

import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";

// ---- 営業時間（20:00〜翌3:00）-------------------------------
const OPEN_TIME = "20:00";
const CLOSE_TIME = "03:00";
const SLOT_MINUTES = 30;

type PeriodStatus = "open" | "closed" | "published";
type PreferenceType = "preferred" | "available" | "unavailable";

interface Profile {
  id: string;
  full_name: string;
  role: "employee" | "owner";
  employment_type: "regular" | "part_time";
  max_hours_per_month: number | null;
  is_active: boolean;
}
interface ShiftPeriod {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  submission_deadline: string;
  status: PeriodStatus;
}
interface Preference {
  id: string;
  employee_id: string;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  preference: PreferenceType;
  note: string | null;
}
interface Confirmed {
  id: string;
  employee_id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  position: string | null;
  note: string | null;
}

function isNextDay(t: string) {
  return t.slice(0, 5) < OPEN_TIME;
}
function timeLabel(t: string | null) {
  if (!t) return "";
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
function buildSlots(open: string, close: string) {
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  const fmt = (mins: number) => {
    const m = ((mins % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(
      m % 60
    ).padStart(2, "0")}`;
  };
  const slots: string[] = [];
  for (let m = toMin(open); m <= toMin(close) + 1440; m += SLOT_MINUTES)
    slots.push(fmt(m));
  return slots;
}
const TIME_SLOTS = buildSlots(OPEN_TIME, CLOSE_TIME);

const PREF_META: Record<PreferenceType, { label: string; chip: string }> = {
  preferred: { label: "希望", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  available: { label: "勤務可能", chip: "bg-sky-50 text-sky-700 border-sky-200" },
  unavailable: { label: "NG", chip: "bg-rose-50 text-rose-700 border-rose-200" },
};
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function toKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
function fromKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function mdLabel(key: string) {
  const d = fromKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

// 1セルをCSV用にエスケープ（カンマ・改行・引用符を含む場合のみ "" で囲む）
function csvCell(v: string) {
  const s = v ?? "";
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: string[][]) {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
// ファイル名に使えない文字を置換
function sanitizeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "shift";
}

export default function OwnerScheduleBuilder() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periods, setPeriods] = useState<ShiftPeriod[]>([]);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [prefs, setPrefs] = useState<Preference[]>([]);
  const [confirmed, setConfirmed] = useState<Confirmed[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [showNewPeriod, setShowNewPeriod] = useState(false);

  const period = useMemo(
    () => periods.find((p) => p.id === periodId) ?? null,
    [periods, periodId]
  );
  const profilesById = useMemo(() => {
    const m = new Map<string, Profile>();
    profiles.forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles]);
  const activeEmployees = useMemo(
    () => profiles.filter((p) => p.is_active),
    [profiles]
  );

  // 期間とプロフィールの初期ロード
  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        setUserId(user?.id ?? null);
        const [{ data: ps, error: e1 }, { data: prof, error: e2 }] =
          await Promise.all([
            supabase
              .from("shift_periods")
              .select("*")
              .order("start_date", { ascending: false }),
            supabase.from("profiles").select("*").order("full_name"),
          ]);
        if (e1) throw e1;
        if (e2) throw e2;
        setPeriods(ps ?? []);
        setProfiles(prof ?? []);
        // 既定は「未公開で最新」の期間
        const def =
          (ps ?? []).find((p) => p.status !== "published") ?? (ps ?? [])[0];
        if (def) setPeriodId(def.id);
      } catch (e: any) {
        setError(e?.message ?? "読み込みに失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 期間が変わったら希望と確定を読み込む
  useEffect(() => {
    if (!periodId) return;
    (async () => {
      const [{ data: pr }, { data: cf }] = await Promise.all([
        supabase.from("shift_preferences").select("*").eq("period_id", periodId),
        supabase.from("confirmed_shifts").select("*").eq("period_id", periodId),
      ]);
      setPrefs(pr ?? []);
      setConfirmed(cf ?? []);
      setSelectedDate(null);
      setConfirmingPublish(false);
    })();
  }, [periodId]);

  const dates = useMemo(() => {
    if (!period) return [] as string[];
    const out: string[] = [];
    const cur = fromKey(period.start_date);
    const end = fromKey(period.end_date);
    while (cur <= end) {
      out.push(toKey(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [period]);

  const prefsByDate = useMemo(() => {
    const m = new Map<string, Preference[]>();
    prefs.forEach((p) => {
      const a = m.get(p.work_date) ?? [];
      a.push(p);
      m.set(p.work_date, a);
    });
    return m;
  }, [prefs]);
  const confirmedByDate = useMemo(() => {
    const m = new Map<string, Confirmed[]>();
    confirmed.forEach((c) => {
      const a = m.get(c.work_date) ?? [];
      a.push(c);
      m.set(c.work_date, a);
    });
    return m;
  }, [confirmed]);

  // 従業員ごとの確定合計時間
  const hoursByEmployee = useMemo(() => {
    const m = new Map<string, number>();
    confirmed.forEach((c) => {
      const h = hoursBetween(c.start_time, c.end_time);
      m.set(c.employee_id, (m.get(c.employee_id) ?? 0) + h);
    });
    return m;
  }, [confirmed]);

  // ---- 操作 --------------------------------------------------
  const addConfirmed = useCallback(
    async (row: {
      employee_id: string;
      work_date: string;
      start_time: string;
      end_time: string;
      position?: string | null;
    }) => {
      if (!periodId) return;
      const { data, error: e } = await supabase
        .from("confirmed_shifts")
        .insert({ period_id: periodId, position: null, ...row })
        .select()
        .single();
      if (e) return setError(e.message);
      if (data) setConfirmed((prev) => [...prev, data as Confirmed]);
    },
    [periodId]
  );

  const updateConfirmed = useCallback(
    async (id: string, patch: Partial<Confirmed>) => {
      setConfirmed((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
      );
      const { error: e } = await supabase
        .from("confirmed_shifts")
        .update(patch)
        .eq("id", id);
      if (e) setError(e.message);
    },
    []
  );

  const removeConfirmed = useCallback(async (id: string) => {
    setConfirmed((prev) => prev.filter((c) => c.id !== id));
    const { error: e } = await supabase
      .from("confirmed_shifts")
      .delete()
      .eq("id", id);
    if (e) setError(e.message);
  }, []);

  const setStatus = useCallback(
    async (status: PeriodStatus) => {
      if (!periodId) return;
      const { error: e } = await supabase
        .from("shift_periods")
        .update({ status })
        .eq("id", periodId);
      if (e) return setError(e.message);
      setPeriods((prev) =>
        prev.map((p) => (p.id === periodId ? { ...p, status } : p))
      );
      setConfirmingPublish(false);
    },
    [periodId]
  );

  // 提出期間の新規作成（成功時は null、失敗時はエラーメッセージを返す）
  const createPeriod = useCallback(
    async (input: {
      title: string;
      start_date: string;
      end_date: string;
      submission_deadline: string;
    }): Promise<string | null> => {
      if (!userId)
        return "ユーザー情報を取得できませんでした。再ログインしてください。";
      const { data, error: e } = await supabase
        .from("shift_periods")
        .insert({ ...input, status: "open", created_by: userId })
        .select()
        .single();
      if (e) return e.message;
      if (data) {
        const created = data as ShiftPeriod;
        setPeriods((prev) =>
          [created, ...prev].sort((a, b) =>
            b.start_date.localeCompare(a.start_date)
          )
        );
        setPeriodId(created.id);
        setShowNewPeriod(false);
      }
      return null;
    },
    [userId]
  );

  // 確定シフトをCSVでダウンロード（選択中の期間）
  const exportCsv = useCallback(() => {
    if (!period || confirmed.length === 0) return;
    const header = [
      "日付",
      "曜日",
      "従業員",
      "開始",
      "終了",
      "時間数",
      "担当",
      "備考",
    ];
    const sorted = [...confirmed].sort((a, b) =>
      a.work_date !== b.work_date
        ? a.work_date.localeCompare(b.work_date)
        : a.start_time.localeCompare(b.start_time)
    );
    const body = sorted.map((c) => [
      c.work_date,
      WEEKDAYS[fromKey(c.work_date).getDay()],
      profilesById.get(c.employee_id)?.full_name ?? "不明",
      timeLabel(c.start_time),
      timeLabel(c.end_time),
      String(hoursBetween(c.start_time, c.end_time)),
      c.position ?? "",
      c.note ?? "",
    ]);
    // 先頭にUTF-8 BOM(﻿)を付け、Excelでの文字化けを防ぐ
    const csv = "﻿" + toCsv([header, ...body]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shift_${sanitizeFileName(period.title)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [period, confirmed, profilesById]);

  // ---- 描画 --------------------------------------------------
  if (loading)
    return <div className="p-8 text-center text-slate-500">読み込み中…</div>;
  if (error && !period)
    return <div className="p-8 text-center text-rose-600">{error}</div>;
  if (!period)
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <h1 className="mb-1 text-2xl font-bold text-slate-900">シフト作成</h1>
        <p className="mb-6 text-sm text-slate-500">
          まず提出期間を作成します。従業員はこの期間に希望シフトを提出できます。
        </p>
        <NewPeriodForm onCreate={createPeriod} />
      </div>
    );

  const dayPrefs = selectedDate ? prefsByDate.get(selectedDate) ?? [] : [];
  const dayConfirmed = selectedDate
    ? confirmedByDate.get(selectedDate) ?? []
    : [];
  // すでに確定に入っている従業員（希望側の二重表示を避けるため印を付ける）
  const confirmedEmpIds = new Set(dayConfirmed.map((c) => c.employee_id));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* ヘッダー */}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">シフト作成</h1>
          <div className="mt-2 flex items-center gap-2">
            <select
              value={periodId ?? ""}
              onChange={(e) => setPeriodId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}（{p.start_date}〜{p.end_date}）
                </option>
              ))}
            </select>
            <StatusBadge status={period.status} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={confirmed.length === 0}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            title={
              confirmed.length === 0
                ? "確定シフトがありません"
                : "この期間の確定シフトをCSVで出力"
            }
          >
            CSV出力
          </button>
          <button
            type="button"
            onClick={() => setShowNewPeriod((v) => !v)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ＋ 新規期間
          </button>
          {period.status === "open" && (
            <button
              type="button"
              onClick={() => setStatus("closed")}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              受付を締め切る
            </button>
          )}
          {period.status !== "published" ? (
            confirmingPublish ? (
              <span className="flex items-center gap-2">
                <span className="text-sm text-slate-500">公開しますか？</span>
                <button
                  type="button"
                  onClick={() => setStatus("published")}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  公開する
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingPublish(false)}
                  className="rounded-lg px-2 py-2 text-sm text-slate-500"
                >
                  取消
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingPublish(true)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                確定を公開
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => setStatus("closed")}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              公開を取り下げて編集
            </button>
          )}
        </div>
      </header>

      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {showNewPeriod && (
        <div className="mb-5">
          <NewPeriodForm
            onCreate={createPeriod}
            onCancel={() => setShowNewPeriod(false)}
          />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div>
          {/* 日付ストリップ */}
          <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
            {dates.map((key) => {
              const pc = (prefsByDate.get(key) ?? []).filter(
                (p) => p.preference !== "unavailable"
              ).length;
              const cc = (confirmedByDate.get(key) ?? []).length;
              const active = key === selectedDate;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDate(key)}
                  className={`flex shrink-0 flex-col items-center rounded-xl border px-3 py-2 text-sm transition ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                  }`}
                >
                  <span className="font-semibold">{mdLabel(key)}</span>
                  <span
                    className={`mt-0.5 text-[11px] ${
                      active ? "text-slate-200" : "text-slate-400"
                    }`}
                  >
                    希望{pc}・確定{cc}
                  </span>
                </button>
              );
            })}
          </div>

          {!selectedDate ? (
            <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
              上の日付を選ぶと、その日の希望と確定シフトを編集できます。
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {/* 希望一覧 */}
              <section>
                <h2 className="mb-2 text-sm font-bold text-slate-700">
                  {mdLabel(selectedDate)} の希望
                </h2>
                {dayPrefs.length === 0 ? (
                  <p className="text-sm text-slate-400">提出はありません。</p>
                ) : (
                  <ul className="space-y-2">
                    {dayPrefs
                      .slice()
                      .sort(
                        (a, b) =>
                          rank(a.preference) - rank(b.preference)
                      )
                      .map((p) => {
                        const name =
                          profilesById.get(p.employee_id)?.full_name ?? "不明";
                        const ng = p.preference === "unavailable";
                        return (
                          <li
                            key={p.id}
                            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                              PREF_META[p.preference].chip
                            }`}
                          >
                            <span>
                              <span className="font-semibold">{name}</span>
                              <span className="ml-2">
                                {PREF_META[p.preference].label}
                              </span>
                              {p.start_time && (
                                <span className="ml-2 font-normal">
                                  {timeLabel(p.start_time)}–
                                  {timeLabel(p.end_time)}
                                </span>
                              )}
                              {p.note && (
                                <span className="ml-2 font-normal text-slate-500">
                                  / {p.note}
                                </span>
                              )}
                            </span>
                            {!ng &&
                              p.start_time &&
                              p.end_time &&
                              !confirmedEmpIds.has(p.employee_id) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    addConfirmed({
                                      employee_id: p.employee_id,
                                      work_date: p.work_date,
                                      start_time: p.start_time!,
                                      end_time: p.end_time!,
                                    })
                                  }
                                  className="ml-2 shrink-0 rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-800"
                                >
                                  確定に入れる
                                </button>
                              )}
                          </li>
                        );
                      })}
                  </ul>
                )}
              </section>

              {/* 確定シフト */}
              <section>
                <h2 className="mb-2 text-sm font-bold text-slate-700">
                  {mdLabel(selectedDate)} の確定シフト
                </h2>
                {dayConfirmed.length === 0 ? (
                  <p className="mb-3 text-sm text-slate-400">
                    まだ確定はありません。
                  </p>
                ) : (
                  <ul className="mb-3 space-y-2">
                    {dayConfirmed.map((c) => (
                      <ConfirmedRow
                        key={c.id}
                        row={c}
                        name={
                          profilesById.get(c.employee_id)?.full_name ?? "不明"
                        }
                        onUpdate={updateConfirmed}
                        onRemove={removeConfirmed}
                      />
                    ))}
                  </ul>
                )}
                <ManualAdd
                  dateKey={selectedDate}
                  employees={activeEmployees}
                  existing={confirmedEmpIds}
                  onAdd={addConfirmed}
                />
              </section>
            </div>
          )}
        </div>

        {/* 合計時間パネル */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <h2 className="mb-2 text-sm font-bold text-slate-700">
            確定合計時間（期間）
          </h2>
          <ul className="space-y-1.5">
            {activeEmployees
              .filter(
                (e) => e.role === "employee" || (hoursByEmployee.get(e.id) ?? 0) > 0
              )
              .map((e) => {
                const h = hoursByEmployee.get(e.id) ?? 0;
                const cap = e.max_hours_per_month;
                const over = cap != null && h > cap;
                const near = cap != null && !over && h >= cap * 0.9;
                return (
                  <li
                    key={e.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-1.5 text-sm"
                  >
                    <span className="truncate text-slate-700">
                      {e.full_name}
                      {e.employment_type === "part_time" && (
                        <span className="ml-1 text-[10px] text-slate-400">
                          P
                        </span>
                      )}
                    </span>
                    <span
                      className={`ml-2 shrink-0 font-medium ${
                        over
                          ? "text-rose-600"
                          : near
                          ? "text-amber-600"
                          : "text-slate-500"
                      }`}
                    >
                      {h}h{cap != null ? ` / ${cap}h` : ""}
                    </span>
                  </li>
                );
              })}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            上限（扶養・契約）を超えると赤、9割以上で黄色。上限は従業員プロフィールで設定します。
          </p>
        </aside>
      </div>
    </div>
  );
}

// 希望の並び順：希望→勤務可能→NG
function rank(t: PreferenceType) {
  return t === "preferred" ? 0 : t === "available" ? 1 : 2;
}

function StatusBadge({ status }: { status: PeriodStatus }) {
  const map: Record<PeriodStatus, { label: string; cls: string }> = {
    open: { label: "受付中", cls: "bg-emerald-100 text-emerald-700" },
    closed: { label: "締切・調整中", cls: "bg-amber-100 text-amber-700" },
    published: { label: "公開済み", cls: "bg-slate-200 text-slate-700" },
  };
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${map[status].cls}`}
    >
      {map[status].label}
    </span>
  );
}

// 提出期間の作成フォーム
function NewPeriodForm({
  onCreate,
  onCancel,
}: {
  onCreate: (input: {
    title: string;
    start_date: string;
    end_date: string;
    submission_deadline: string;
  }) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit() {
    setLocalError(null);
    if (!title.trim()) return setLocalError("タイトルを入力してください。");
    if (!startDate || !endDate)
      return setLocalError("開始日と終了日を入力してください。");
    if (endDate < startDate)
      return setLocalError("終了日は開始日以降にしてください。");
    if (!deadline) return setLocalError("提出締切を入力してください。");

    setSaving(true);
    const msg = await onCreate({
      title: title.trim(),
      start_date: startDate,
      end_date: endDate,
      // datetime-local（端末ローカル時刻）をISO(UTC)に変換して保存
      submission_deadline: new Date(deadline).toISOString(),
    });
    setSaving(false);
    if (msg) {
      setLocalError(msg);
    } else {
      setTitle("");
      setStartDate("");
      setEndDate("");
      setDeadline("");
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-bold text-slate-700">提出期間を作成</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            タイトル
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: 2026年7月前半"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            開始日
          </span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            終了日
          </span>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            提出締切（日時）
          </span>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
        </label>
      </div>

      {localError && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {localError}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? "作成中…" : "この期間を作成"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:text-slate-700"
          >
            取消
          </button>
        )}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
        作成すると「受付中」状態になり、従業員が希望を提出できます。締切後に
        「受付を締め切る」→「確定を公開」と進めます。
      </p>
    </div>
  );
}

// 確定シフト1行（時間・担当を即時編集）
function ConfirmedRow({
  row,
  name,
  onUpdate,
  onRemove,
}: {
  row: Confirmed;
  name: string;
  onUpdate: (id: string, patch: Partial<Confirmed>) => void;
  onRemove: (id: string) => void;
}) {
  const startIdx = TIME_SLOTS.indexOf(row.start_time.slice(0, 5));
  return (
    <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-800">{name}</span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-slate-400">
            {hoursBetween(row.start_time, row.end_time)}h
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
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
        <select
          value={row.start_time.slice(0, 5)}
          onChange={(e) => {
            const s = e.target.value;
            const ei = TIME_SLOTS.indexOf(row.end_time.slice(0, 5));
            const si = TIME_SLOTS.indexOf(s);
            const patch: Partial<Confirmed> = { start_time: s };
            if (ei <= si)
              patch.end_time = TIME_SLOTS[Math.min(si + 1, TIME_SLOTS.length - 1)];
            onUpdate(row.id, patch);
          }}
          className="rounded-md border border-slate-200 px-1.5 py-1"
        >
          {TIME_SLOTS.slice(0, -1).map((t) => (
            <option key={t} value={t}>
              {timeLabel(t)}
            </option>
          ))}
        </select>
        <span className="text-slate-400">–</span>
        <select
          value={row.end_time.slice(0, 5)}
          onChange={(e) => onUpdate(row.id, { end_time: e.target.value })}
          className="rounded-md border border-slate-200 px-1.5 py-1"
        >
          {TIME_SLOTS.filter((_, i) => i > startIdx).map((t) => (
            <option key={t} value={t}>
              {timeLabel(t)}
            </option>
          ))}
        </select>
        <input
          type="text"
          defaultValue={row.position ?? ""}
          onBlur={(e) =>
            onUpdate(row.id, { position: e.target.value.trim() || null })
          }
          placeholder="担当(任意)"
          className="w-24 rounded-md border border-slate-200 px-2 py-1"
        />
      </div>
    </li>
  );
}

// 手動追加フォーム
function ManualAdd({
  dateKey,
  employees,
  existing,
  onAdd,
}: {
  dateKey: string;
  employees: Profile[];
  existing: Set<string>;
  onAdd: (row: {
    employee_id: string;
    work_date: string;
    start_time: string;
    end_time: string;
  }) => void;
}) {
  const candidates = employees.filter((e) => !existing.has(e.id));
  const [empId, setEmpId] = useState("");
  const [start, setStart] = useState(OPEN_TIME);
  const [end, setEnd] = useState("03:00");
  const startIdx = TIME_SLOTS.indexOf(start);

  function add() {
    if (!empId) return;
    onAdd({ employee_id: empId, work_date: dateKey, start_time: start, end_time: end });
    setEmpId("");
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-3">
      <p className="mb-2 text-xs font-medium text-slate-500">手動で追加</p>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <select
          value={empId}
          onChange={(e) => setEmpId(e.target.value)}
          className="rounded-md border border-slate-200 px-2 py-1"
        >
          <option value="">従業員を選択</option>
          {candidates.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name}
            </option>
          ))}
        </select>
        <select
          value={start}
          onChange={(e) => {
            const s = e.target.value;
            setStart(s);
            const si = TIME_SLOTS.indexOf(s);
            if (TIME_SLOTS.indexOf(end) <= si)
              setEnd(TIME_SLOTS[Math.min(si + 1, TIME_SLOTS.length - 1)]);
          }}
          className="rounded-md border border-slate-200 px-1.5 py-1"
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
          className="rounded-md border border-slate-200 px-1.5 py-1"
        >
          {TIME_SLOTS.filter((_, i) => i > startIdx).map((t) => (
            <option key={t} value={t}>
              {timeLabel(t)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={add}
          disabled={!empId}
          className="rounded-md bg-slate-900 px-3 py-1 font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
        >
          追加
        </button>
      </div>
    </div>
  );
}
