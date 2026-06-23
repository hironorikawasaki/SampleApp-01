"use client";

// =============================================================
// 店舗キオスク打刻（オーナー端末＝Padを店舗に据え置く）
//   - 店舗を選び、在籍従業員を大きなボタンで一覧
//   - 名前をタップ → 4桁PIN → 出勤/退勤をトグル（kiosk_punch RPC）
//   - 個人ログイン不要。PINでなりすましを抑止。
// 依存: @/lib/supabaseClient, @/lib/shiftTime
// =============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  businessDayKey,
  clockLabel,
  WEEKDAYS,
  mdLabel,
  toKey,
} from "@/lib/shiftTime";
import { PageSkeleton } from "@/components/Skeleton";

interface Store {
  id: string;
  name: string;
}
interface Emp {
  id: string;
  name: string;
}

export default function Kiosk() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [scheduledIds, setScheduledIds] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Emp | null>(null);
  const [showExit, setShowExit] = useState(false);

  // 店舗一覧（オーナーは全店舗閲覧可）。前回選択を localStorage で復元。
  useEffect(() => {
    (async () => {
      const { data, error: e } = await supabase
        .from("stores")
        .select("id,name,is_active")
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      if (e) setError(e.message);
      const list = (data ?? []).map((s) => ({ id: s.id, name: s.name }));
      setStores(list);
      let remembered: string | null = null;
      try {
        remembered = localStorage.getItem("kiosk-store");
      } catch {
        /* ignore */
      }
      setStoreId(
        list.find((s) => s.id === remembered)?.id ?? list[0]?.id ?? null
      );
      setLoading(false);
    })();
  }, []);

  const loadStore = useCallback(async (sid: string) => {
    const today = businessDayKey(new Date());
    const [{ data: mem }, { data: open }, { data: sched }] = await Promise.all([
      supabase
        .from("store_members")
        .select("profiles(id,full_name,is_active)")
        .eq("store_id", sid),
      supabase
        .from("attendance_records")
        .select("employee_id")
        .eq("store_id", sid)
        .is("clock_out", null),
      // 当日(営業日)の出勤予定者＝確定シフトのある従業員
      supabase
        .from("confirmed_shifts")
        .select("employee_id,shift_periods!inner(store_id)")
        .eq("shift_periods.store_id", sid)
        .eq("work_date", today),
    ]);
    const list = (mem ?? [])
      .map((m: any) => m.profiles)
      .filter((p: any) => p && p.is_active)
      .map((p: any) => ({ id: p.id as string, name: p.full_name as string }))
      .sort((a: Emp, b: Emp) => a.name.localeCompare(b.name));
    setEmps(list);
    setOpenIds(new Set((open ?? []).map((o) => o.employee_id)));
    setScheduledIds(new Set((sched ?? []).map((s: any) => s.employee_id)));
  }, []);

  useEffect(() => {
    if (storeId) loadStore(storeId);
  }, [storeId, loadStore]);

  function changeStore(sid: string) {
    setStoreId(sid);
    try {
      localStorage.setItem("kiosk-store", sid);
    } catch {
      /* ignore */
    }
  }

  const storeName = useMemo(
    () => stores.find((s) => s.id === storeId)?.name ?? "",
    [stores, storeId]
  );

  if (loading)
    return <PageSkeleton />;
  if (stores.length === 0)
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center text-slate-500">
        店舗がありません。「店舗管理」で作成してください。
      </div>
    );

  const scheduled = emps.filter((e) => scheduledIds.has(e.id));
  const others = emps.filter((e) => !scheduledIds.has(e.id));
  const renderEmp = (e: Emp) => {
    const working = openIds.has(e.id);
    return (
      <button
        key={e.id}
        type="button"
        onClick={() => setPicked(e)}
        className={`flex flex-col items-center justify-center rounded-2xl border p-5 text-center transition ${
          working
            ? "border-emerald-300 bg-emerald-50 hover:border-emerald-400"
            : "border-slate-200 bg-white hover:border-slate-400"
        }`}
      >
        <span className="text-lg font-bold text-slate-900">{e.name}</span>
        <span
          className={`mt-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            working ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"
          }`}
        >
          {working ? "出勤中" : "退勤中"}
        </span>
      </button>
    );
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">打刻</h1>
          <p className="text-sm text-slate-500">{storeName}</p>
          <select
            value={storeId ?? ""}
            onChange={(e) => changeStore(e.target.value)}
            className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div>
            <button
              type="button"
              onClick={() => setShowExit(true)}
              className="mt-2 text-xs text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
            >
              🔒 管理メニュー
            </button>
          </div>
        </div>
        <KioskClock />
      </header>

      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {emps.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
          この店舗に在籍中の従業員がいません。
        </p>
      ) : (
        <div className="space-y-6">
          {scheduled.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-bold text-slate-700">
                本日の出勤予定
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {scheduled.map(renderEmp)}
              </div>
            </section>
          )}
          {others.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-bold text-slate-700">
                {scheduled.length > 0 ? "その他の在籍者" : "在籍者"}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {others.map(renderEmp)}
              </div>
            </section>
          )}
        </div>
      )}

      {picked && storeId && (
        <PinPad
          emp={picked}
          working={openIds.has(picked.id)}
          onClose={() => setPicked(null)}
          onPunch={async (pin) => {
            const { data, error: e } = await supabase.rpc("kiosk_punch", {
              p_employee: picked.id,
              p_store: storeId,
              p_pin: pin,
              p_work_date: businessDayKey(new Date()),
            });
            if (e) return { error: e.message };
            const res = data as
              | { error: string }
              | { action: "in" | "out"; at: string };
            if ("error" in res) return { error: res.error };
            await loadStore(storeId);
            return {
              ok: `${picked.name} さん ${
                res.action === "in" ? "出勤" : "退勤"
              } ${clockLabel(res.at)}`,
            };
          }}
        />
      )}

      {showExit && <ExitGate onClose={() => setShowExit(false)} />}
    </div>
  );
}

// キオスクを抜けて管理画面に戻るゲート。オーナーのパスワード再認証を要求し、
// 店舗据え置きのPadから無認証でオーナー機能に入れないようにする。
function ExitGate({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function unlock() {
    setBusy(true);
    setErr(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const email = session?.user?.email;
    if (!email) {
      setBusy(false);
      setErr("セッションを取得できません。再ログインしてください。");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: pw,
    });
    setBusy(false);
    if (error) {
      setErr("パスワードが正しくありません。");
      setPw("");
      return;
    }
    router.push("/timecards");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">管理メニュー</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>
        <p className="mb-3 text-sm text-slate-500">
          打刻モードを終了して管理画面に戻ります。オーナーのパスワードを入力してください。
        </p>
        <input
          type="password"
          value={pw}
          onChange={(e) => {
            setPw(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && pw && !busy) unlock();
          }}
          placeholder="パスワード"
          autoFocus
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        />
        {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
        <button
          type="button"
          onClick={unlock}
          disabled={busy || !pw}
          className="mt-3 w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "確認中…" : "解除して管理画面へ"}
        </button>
      </div>
    </div>
  );
}

// 現在日時のライブ表示。深夜帯は「営業日」も明示（打刻がどの営業日になるか）。
function KioskClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const p = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${now.getMonth() + 1}月${now.getDate()}日(${
    WEEKDAYS[now.getDay()]
  })`;
  const timeStr = `${p(now.getHours())}:${p(now.getMinutes())}:${p(
    now.getSeconds()
  )}`;
  const biz = businessDayKey(now);
  return (
    <div className="text-right">
      <div className="text-sm text-slate-500">{dateStr}</div>
      <div className="text-3xl font-bold tabular-nums text-slate-900">
        {timeStr}
      </div>
      {biz !== toKey(now) && (
        <div className="mt-0.5 text-xs font-medium text-amber-600">
          営業日：{mdLabel(biz)}
        </div>
      )}
    </div>
  );
}

// 4桁PIN入力（テンキー）。出勤/退勤をトグル。
function PinPad({
  emp,
  working,
  onClose,
  onPunch,
}: {
  emp: Emp;
  working: boolean;
  onClose: () => void;
  onPunch: (pin: string) => Promise<{ ok?: string; error?: string }>;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(p: string) {
    setBusy(true);
    setMsg(null);
    const r = await onPunch(p);
    setBusy(false);
    if (r.error) {
      setMsg(r.error);
      setPin("");
    } else {
      setDone(true);
      setMsg(r.ok ?? "完了しました");
      setTimeout(onClose, 1500);
    }
  }

  function press(d: string) {
    if (busy || done) return;
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) submit(next);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">{emp.name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>
        <p className="mb-3 text-sm text-slate-500">
          {working ? "退勤" : "出勤"}します。PIN（4桁）を入力してください。
        </p>

        {/* PIN表示 */}
        <div className="mb-3 flex justify-center gap-3">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-3.5 w-3.5 rounded-full ${
                i < pin.length ? "bg-slate-900" : "bg-slate-200"
              }`}
            />
          ))}
        </div>

        {msg && (
          <p
            className={`mb-3 rounded-lg px-3 py-2 text-center text-sm ${
              done ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
            }`}
          >
            {msg}
          </p>
        )}

        {!done && (
          <div className="grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => press(d)}
                disabled={busy}
                className="rounded-xl border border-slate-200 py-3 text-xl font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPin("")}
              disabled={busy}
              className="rounded-xl border border-slate-200 py-3 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              クリア
            </button>
            <button
              type="button"
              onClick={() => press("0")}
              disabled={busy}
              className="rounded-xl border border-slate-200 py-3 text-xl font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              0
            </button>
            <button
              type="button"
              onClick={() => setPin((p) => p.slice(0, -1))}
              disabled={busy}
              className="rounded-xl border border-slate-200 py-3 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              ←
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
