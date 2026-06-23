"use client";

// =============================================================
// 店舗キオスク打刻（オーナー端末＝Padを店舗に据え置く）
//   - 店舗を選び、在籍従業員を大きなボタンで一覧
//   - 名前をタップ → 4桁PIN → 出勤/退勤をトグル（kiosk_punch RPC）
//   - 個人ログイン不要。PINでなりすましを抑止。
// 依存: @/lib/supabaseClient, @/lib/shiftTime
// =============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { businessDayKey, clockLabel } from "@/lib/shiftTime";

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
  const [picked, setPicked] = useState<Emp | null>(null);

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
    const [{ data: mem }, { data: open }] = await Promise.all([
      supabase
        .from("store_members")
        .select("profiles(id,full_name,is_active)")
        .eq("store_id", sid),
      supabase
        .from("attendance_records")
        .select("employee_id")
        .eq("store_id", sid)
        .is("clock_out", null),
    ]);
    const list = (mem ?? [])
      .map((m: any) => m.profiles)
      .filter((p: any) => p && p.is_active)
      .map((p: any) => ({ id: p.id as string, name: p.full_name as string }))
      .sort((a: Emp, b: Emp) => a.name.localeCompare(b.name));
    setEmps(list);
    setOpenIds(new Set((open ?? []).map((o) => o.employee_id)));
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
    return <div className="p-8 text-center text-slate-500">読み込み中…</div>;
  if (stores.length === 0)
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center text-slate-500">
        店舗がありません。「店舗管理」で作成してください。
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">打刻</h1>
          <p className="text-sm text-slate-500">{storeName}</p>
        </div>
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {emps.map((e) => {
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
                <span className="text-lg font-bold text-slate-900">
                  {e.name}
                </span>
                <span
                  className={`mt-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                    working
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {working ? "出勤中" : "退勤中"}
                </span>
              </button>
            );
          })}
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
