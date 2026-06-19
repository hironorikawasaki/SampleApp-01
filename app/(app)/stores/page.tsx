"use client";

// =============================================================
// オーナー向け 店舗管理
//   - 店舗の作成・名称変更・有効/無効を管理
//   - 従業員の店舗割り当ては /employees で行う
// 依存: @/lib/supabaseClient
// スキーマ: stores（0003_multi_store.sql）
// =============================================================

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

interface Store {
  id: string;
  name: string;
  is_active: boolean;
}

export default function StoreManager() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error: e } = await supabase
        .from("stores")
        .select("id,name,is_active")
        .order("created_at", { ascending: true });
      if (e) setError(e.message);
      else setStores(data ?? []);
      setLoading(false);
    })();
  }, []);

  async function createStore() {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("stores")
      .insert({ name })
      .select("id,name,is_active")
      .single();
    setSaving(false);
    if (e) return setError(e.message);
    if (data) {
      setStores((prev) => [...prev, data as Store]);
      setNewName("");
    }
  }

  async function update(id: string, patch: Partial<Store>) {
    setStores((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const { error: e } = await supabase.from("stores").update(patch).eq("id", id);
    if (e) setError(e.message);
  }

  if (loading)
    return <div className="p-8 text-center text-slate-500">読み込み中…</div>;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">店舗の管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          店舗を作成し、従業員の割り当ては「従業員管理」で行います。
        </p>
      </header>

      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {/* 新規作成 */}
      <div className="mb-6 flex items-center gap-2 rounded-xl border border-dashed border-slate-300 p-3">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") createStore();
          }}
          placeholder="新しい店舗名（例：渋谷店）"
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={createStore}
          disabled={saving || !newName.trim()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {saving ? "追加中…" : "店舗を追加"}
        </button>
      </div>

      {/* 一覧 */}
      {stores.length === 0 ? (
        <p className="text-sm text-slate-400">店舗がまだありません。</p>
      ) : (
        <ul className="space-y-2">
          {stores.map((s) => (
            <li
              key={s.id}
              className={`flex flex-wrap items-center gap-2 rounded-xl border p-3 ${
                s.is_active
                  ? "border-slate-200 bg-white"
                  : "border-slate-100 bg-slate-50"
              }`}
            >
              <input
                type="text"
                defaultValue={s.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== s.name) update(s.id, { name: v });
                }}
                className="min-w-[10rem] flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-900"
              />
              {!s.is_active && (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-600">
                  無効
                </span>
              )}
              <button
                type="button"
                onClick={() => update(s.id, { is_active: !s.is_active })}
                className={`ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  s.is_active
                    ? "border border-slate-300 text-slate-600 hover:bg-slate-50"
                    : "bg-emerald-600 text-white hover:bg-emerald-700"
                }`}
              >
                {s.is_active ? "無効化" : "有効化"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
