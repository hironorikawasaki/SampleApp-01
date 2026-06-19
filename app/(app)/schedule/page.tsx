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
import { config } from "@/lib/config";
import {
  WEEKDAYS,
  TIME_SLOTS,
  timeLabel,
  hoursBetween,
  toKey,
  fromKey,
  mdLabel,
} from "@/lib/shiftTime";
import { monthlyHoursByEmployee, monthLabel, type ShiftHours } from "@/lib/hours";

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
  store_id: string;
}
interface Store {
  id: string;
  name: string;
  is_active: boolean;
}
const memberKey = (empId: string, storeId: string) => `${empId}:${storeId}`;
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

const PREF_META: Record<PreferenceType, { label: string; chip: string }> = {
  preferred: { label: "希望", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  available: { label: "勤務可能", chip: "bg-sky-50 text-sky-700 border-sky-200" },
  unavailable: { label: "NG", chip: "bg-rose-50 text-rose-700 border-rose-200" },
};
// ヘッダーのアクションボタン共通クラス（高さ・余白を統一）
// 塗りボタンも border-transparent を持たせ、アウトラインと同じ高さに揃える。
const BTN_BASE =
  "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition";
const BTN_SECONDARY = `${BTN_BASE} border-slate-300 text-slate-700 hover:bg-slate-50`;
const BTN_DANGER_OUTLINE = `${BTN_BASE} border-rose-300 text-rose-600 hover:bg-rose-50`;
const BTN_PRIMARY = `${BTN_BASE} border-transparent bg-slate-900 font-semibold text-white hover:bg-slate-800`;
const BTN_SUCCESS = `${BTN_BASE} border-transparent bg-emerald-600 font-semibold text-white hover:bg-emerald-700`;
const BTN_DANGER = `${BTN_BASE} border-transparent bg-rose-600 font-semibold text-white hover:bg-rose-700`;
const BTN_GHOST = `${BTN_BASE} border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700`;

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
  // 月上限の比較用：選択期間が属する暦月の、同店舗「他期間」の確定シフト。
  // 選択期間ぶんは confirmed を使うため、ここには含めない（二重計上を防ぐ）。
  const [monthShifts, setMonthShifts] = useState<ShiftHours[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Set<string>>(new Set());
  const [showEditPeriod, setShowEditPeriod] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const period = useMemo(
    () => periods.find((p) => p.id === periodId) ?? null,
    [periods, periodId]
  );
  const profilesById = useMemo(() => {
    const m = new Map<string, Profile>();
    profiles.forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles]);
  // 選択中の店舗に所属する在籍従業員のみ
  const activeEmployees = useMemo(
    () =>
      profiles.filter(
        (p) => p.is_active && memberships.has(memberKey(p.id, storeId ?? ""))
      ),
    [profiles, memberships, storeId]
  );
  // 選択中の店舗の提出期間
  const storePeriods = useMemo(
    () => periods.filter((p) => p.store_id === storeId),
    [periods, storeId]
  );

  // 期間とプロフィールの初期ロード
  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        setUserId(user?.id ?? null);
        const [
          { data: ps, error: e1 },
          { data: prof, error: e2 },
          { data: sts, error: e3 },
          { data: mem, error: e4 },
        ] = await Promise.all([
          supabase
            .from("shift_periods")
            .select("*")
            .order("start_date", { ascending: false }),
          supabase.from("profiles").select("*").order("full_name"),
          supabase
            .from("stores")
            .select("id,name,is_active")
            .order("created_at", { ascending: true }),
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
        // 既定の店舗（先頭）と、その店舗の「未公開で最新」の期間を選択
        const firstStore = (sts ?? [])[0]?.id ?? null;
        setStoreId(firstStore);
        const inStore = (ps ?? []).filter((p) => p.store_id === firstStore);
        const def = inStore.find((p) => p.status !== "published") ?? inStore[0];
        setPeriodId(def?.id ?? null);
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
      setConfirmingClose(false);
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

  // この期間が触れる暦月（通常1つ、月跨ぎなら複数）。'YYYY-MM' 昇順。
  const months = useMemo(() => {
    const set = new Set(dates.map((d) => d.slice(0, 7)));
    return [...set].sort();
  }, [dates]);

  // 依存を安定させるためのキー（配列は毎レンダ別参照になるため）
  const monthsKey = months.join(",");
  const storePeriodIdsKey = useMemo(
    () => storePeriods.map((p) => p.id).join(","),
    [storePeriods]
  );

  // 月上限の比較用：選択期間の暦月に属する「他期間」の確定シフトを取得。
  useEffect(() => {
    const monthsArr = monthsKey ? monthsKey.split(",") : [];
    const otherIds = storePeriodIdsKey
      ? storePeriodIdsKey.split(",").filter((id) => id && id !== periodId)
      : [];
    if (!periodId || monthsArr.length === 0 || otherIds.length === 0) {
      setMonthShifts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("confirmed_shifts")
        .select("employee_id, work_date, start_time, end_time")
        .in("period_id", otherIds)
        .gte("work_date", `${monthsArr[0]}-01`)
        .lte("work_date", `${monthsArr[monthsArr.length - 1]}-31`);
      if (!cancelled) setMonthShifts((data as ShiftHours[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [periodId, monthsKey, storePeriodIdsKey]);

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

  // 従業員ごと×暦月の確定合計時間（月上限の比較に使う）。
  // 選択期間ぶん(confirmed)＋同月の他期間ぶん(monthShifts)を合算するので、
  // オーナーの編集も即時に月合計へ反映される。
  const monthlyByEmployee = useMemo(
    () =>
      monthlyHoursByEmployee([
        ...confirmed.map((c) => ({
          employee_id: c.employee_id,
          work_date: c.work_date,
          start_time: c.start_time,
          end_time: c.end_time,
        })),
        ...monthShifts,
      ]),
    [confirmed, monthShifts]
  );

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
      setConfirmingClose(false);
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
      if (!storeId) return "店舗を選択してください。";
      const { data, error: e } = await supabase
        .from("shift_periods")
        .insert({
          ...input,
          status: "open",
          created_by: userId,
          store_id: storeId,
        })
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
    [userId, storeId]
  );

  // 店舗を切り替え、その店舗の既定期間を選択
  const changeStore = useCallback(
    (sid: string) => {
      setStoreId(sid);
      const inStore = periods.filter((p) => p.store_id === sid);
      const def = inStore.find((p) => p.status !== "published") ?? inStore[0];
      setPeriodId(def?.id ?? null);
    },
    [periods]
  );

  // 選択中の期間を編集（成功時 null、失敗時メッセージ）
  const updatePeriod = useCallback(
    async (input: {
      title: string;
      start_date: string;
      end_date: string;
      submission_deadline: string;
    }): Promise<string | null> => {
      if (!periodId) return "期間が選択されていません。";
      const { error: e } = await supabase
        .from("shift_periods")
        .update(input)
        .eq("id", periodId);
      if (e) return e.message;
      setPeriods((prev) =>
        prev
          .map((p) => (p.id === periodId ? { ...p, ...input } : p))
          .sort((a, b) => b.start_date.localeCompare(a.start_date))
      );
      setShowEditPeriod(false);
      setSelectedDate(null);
      return null;
    },
    [periodId]
  );

  // 選択中の期間を削除（希望・確定シフトも cascade で削除される）
  const deletePeriod = useCallback(async () => {
    if (!periodId) return;
    const { error: e } = await supabase
      .from("shift_periods")
      .delete()
      .eq("id", periodId);
    if (e) {
      setError(e.message);
      return;
    }
    const remaining = periods.filter((p) => p.id !== periodId);
    setPeriods(remaining);
    setConfirmingDelete(false);
    setShowEditPeriod(false);
    const inStore = remaining.filter((p) => p.store_id === storeId);
    const next = inStore.find((p) => p.status !== "published") ?? inStore[0];
    setPeriodId(next?.id ?? null);
  }, [periodId, periods, storeId]);

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
        {stores.length === 0 ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
            まだ店舗がありません。先に「店舗管理」で店舗を作成してください。
          </p>
        ) : (
          <>
            <div className="mb-4 mt-2 flex items-center gap-2">
              <span className="text-sm text-slate-500">店舗</span>
              <select
                value={storeId ?? ""}
                onChange={(e) => changeStore(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="mb-6 text-sm text-slate-500">
              この店舗の提出期間を作成します。従業員はこの期間に希望シフトを提出できます。
            </p>
            <PeriodForm onSubmit={createPeriod} />
          </>
        )}
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
            <StatusBadge status={period.status} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={confirmed.length === 0}
            className={`${BTN_SECONDARY} disabled:opacity-40`}
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
            onClick={() => {
              setShowNewPeriod((v) => !v);
              setShowEditPeriod(false);
              setConfirmingDelete(false);
            }}
            className={BTN_SECONDARY}
          >
            ＋ 新規期間
          </button>
          <button
            type="button"
            onClick={() => {
              setShowEditPeriod((v) => !v);
              setShowNewPeriod(false);
              setConfirmingDelete(false);
            }}
            className={BTN_SECONDARY}
          >
            編集
          </button>
          {confirmingDelete ? (
            <span className="flex items-center gap-2">
              <span className="text-sm text-rose-600">
                希望・確定も削除します。よろしいですか？
              </span>
              <button
                type="button"
                onClick={deletePeriod}
                className={BTN_DANGER}
              >
                削除する
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-lg px-2 py-2 text-sm text-slate-500"
              >
                取消
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete(true);
                setShowEditPeriod(false);
                setShowNewPeriod(false);
              }}
              className={BTN_DANGER_OUTLINE}
            >
              削除
            </button>
          )}
          {period.status === "open" &&
            (confirmingClose ? (
              <span className="flex items-center gap-2">
                <span className="text-sm text-slate-500">
                  受付を締め切りますか？
                </span>
                <button
                  type="button"
                  onClick={() => setStatus("closed")}
                  className={BTN_PRIMARY}
                >
                  締め切る
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingClose(false)}
                  className={BTN_GHOST}
                >
                  取消
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setConfirmingClose(true);
                  setConfirmingPublish(false);
                }}
                className={BTN_SECONDARY}
              >
                受付を締め切る
              </button>
            ))}
          {period.status === "closed" && (
            <button
              type="button"
              onClick={() => setStatus("open")}
              className={BTN_SECONDARY}
            >
              受付を再開する
            </button>
          )}
          {period.status !== "published" ? (
            confirmingPublish ? (
              <span className="flex items-center gap-2">
                <span className="text-sm text-slate-500">公開しますか？</span>
                <button
                  type="button"
                  onClick={() => setStatus("published")}
                  className={BTN_SUCCESS}
                >
                  公開する
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingPublish(false)}
                  className={BTN_GHOST}
                >
                  取消
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setConfirmingPublish(true);
                  setConfirmingClose(false);
                }}
                className={BTN_PRIMARY}
              >
                確定を公開
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => setStatus("closed")}
              className={BTN_SECONDARY}
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
          <PeriodForm
            onSubmit={createPeriod}
            onCancel={() => setShowNewPeriod(false)}
          />
        </div>
      )}

      {showEditPeriod && (
        <div className="mb-5">
          <PeriodForm
            key={period.id}
            heading="提出期間を編集"
            submitLabel="変更を保存"
            initial={{
              title: period.title,
              start_date: period.start_date,
              end_date: period.end_date,
              submission_deadline: period.submission_deadline,
            }}
            onSubmit={updatePeriod}
            onCancel={() => setShowEditPeriod(false)}
          />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
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

        {/* 合計時間パネル（暦月単位。月上限と比較） */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <h2 className="mb-2 text-sm font-bold text-slate-700">
            確定合計時間（月）
          </h2>
          <ul className="space-y-1.5">
            {activeEmployees
              .filter((e) => {
                const byMonth = monthlyByEmployee.get(e.id);
                const total = byMonth
                  ? [...byMonth.values()].reduce((a, b) => a + b, 0)
                  : 0;
                return e.role === "employee" || total > 0;
              })
              .map((e) => {
                const byMonth = monthlyByEmployee.get(e.id);
                const cap = e.max_hours_per_month;
                return (
                  <li
                    key={e.id}
                    className="rounded-lg border border-slate-100 bg-white px-3 py-1.5 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate text-slate-700">
                        {e.full_name}
                        {e.employment_type === "part_time" && (
                          <span className="ml-1 text-[10px] text-slate-400">
                            P
                          </span>
                        )}
                      </span>
                      {/* 単月のときは右側に集約表示 */}
                      {months.length === 1 && (
                        <MonthHours h={byMonth?.get(months[0]) ?? 0} cap={cap} />
                      )}
                    </div>
                    {/* 月跨ぎのときは月ごとに表示 */}
                    {months.length > 1 && (
                      <div className="mt-1 space-y-0.5">
                        {months.map((ym) => (
                          <div
                            key={ym}
                            className="flex items-center justify-between text-xs"
                          >
                            <span className="text-slate-400">
                              {monthLabel(ym)}
                            </span>
                            <MonthHours h={byMonth?.get(ym) ?? 0} cap={cap} />
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            暦月ごとの合計を月上限と比較（同じ月の他期間ぶんも合算）。上限超過で赤、9割以上で黄色。上限は従業員プロフィールで設定します。
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

// 月の合計時間を上限と比較して色分け表示（超過=赤 / 9割以上=黄 / それ以外=灰）
function MonthHours({ h, cap }: { h: number; cap: number | null }) {
  const over = cap != null && h > cap;
  const near = cap != null && !over && h >= cap * 0.9;
  return (
    <span
      className={`ml-2 shrink-0 font-medium ${
        over ? "text-rose-600" : near ? "text-amber-600" : "text-slate-500"
      }`}
    >
      {h}h{cap != null ? ` / ${cap}h` : ""}
    </span>
  );
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

// ISO(UTC) を datetime-local 入力用のローカル文字列(YYYY-MM-DDTHH:mm)に変換
function isoToLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 提出期間の作成／編集フォーム（initial があれば編集モード）
function PeriodForm({
  onSubmit,
  onCancel,
  initial,
  heading = "提出期間を作成",
  submitLabel = "この期間を作成",
}: {
  onSubmit: (input: {
    title: string;
    start_date: string;
    end_date: string;
    submission_deadline: string;
  }) => Promise<string | null>;
  onCancel?: () => void;
  initial?: {
    title: string;
    start_date: string;
    end_date: string;
    submission_deadline: string;
  };
  heading?: string;
  submitLabel?: string;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [startDate, setStartDate] = useState(initial?.start_date ?? "");
  const [endDate, setEndDate] = useState(initial?.end_date ?? "");
  const [deadline, setDeadline] = useState(
    initial ? isoToLocalInput(initial.submission_deadline) : ""
  );
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
    const msg = await onSubmit({
      title: title.trim(),
      start_date: startDate,
      end_date: endDate,
      // datetime-local（端末ローカル時刻）をISO(UTC)に変換して保存
      submission_deadline: new Date(deadline).toISOString(),
    });
    setSaving(false);
    if (msg) {
      setLocalError(msg);
    } else if (!initial) {
      setTitle("");
      setStartDate("");
      setEndDate("");
      setDeadline("");
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-bold text-slate-700">{heading}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block min-w-0 sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            タイトル
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: 2026年7月前半"
            className="w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            開始日
          </span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            終了日
          </span>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
        </label>
        <label className="block min-w-0 sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            提出締切（日時）
          </span>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
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
          {saving ? "保存中…" : submitLabel}
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
      {!initial && (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          作成すると「受付中」状態になり、従業員が希望を提出できます。締切後に
          「受付を締め切る」→「確定を公開」と進めます。
        </p>
      )}
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
  const [start, setStart] = useState(config.openTime);
  const [end, setEnd] = useState(config.closeTime);
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
