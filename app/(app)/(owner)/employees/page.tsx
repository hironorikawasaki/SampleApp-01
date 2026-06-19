"use client";

// =============================================================
// オーナー向け 従業員プロフィール管理
//   - 全プロフィールを一覧し、氏名・役割・雇用形態・月上限・在籍を編集
//   - 上限時間(max_hours_per_month)はシフト作成画面の超過警告に連動
//   - 自分自身の「役割変更」「無効化」は不可（ロックアウト防止）
//   ※ 動作には 0002_profiles_admin.sql（RLS追加＋保護トリガー）が必要
// 依存: @/lib/supabaseClient
// =============================================================

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

interface Profile {
  id: string;
  full_name: string;
  role: "employee" | "owner";
  employment_type: "regular" | "part_time";
  max_hours_per_month: number | null;
  phone: string | null;
  is_active: boolean;
}
interface Store {
  id: string;
  name: string;
  is_active: boolean;
}

// 所属の集合キー
const memberKey = (empId: string, storeId: string) => `${empId}:${storeId}`;

export default function EmployeeManager() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [memberships, setMemberships] = useState<Set<string>>(new Set());

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
        setMeId(user.id);
        const [{ data: profs, error: e }, { data: sts }, { data: mem }] =
          await Promise.all([
            supabase
              .from("profiles")
              .select("*")
              .order("is_active", { ascending: false })
              .order("full_name"),
            supabase
              .from("stores")
              .select("id,name,is_active")
              .order("created_at", { ascending: true }),
            supabase.from("store_members").select("store_id,employee_id"),
          ]);
        if (e) throw e;
        setProfiles(profs ?? []);
        setStores(sts ?? []);
        setMemberships(
          new Set((mem ?? []).map((m) => memberKey(m.employee_id, m.store_id)))
        );
      } catch (e: any) {
        setError(e?.message ?? "読み込みに失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function update(id: string, patch: Partial<Profile>) {
    // 楽観的更新：失敗時は更新前の状態へ戻す（UIとDBの不一致を防ぐ）
    const prev = profiles;
    setProfiles((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    const { error: e } = await supabase.from("profiles").update(patch).eq("id", id);
    if (e) {
      setProfiles(prev);
      setError(e.message);
    }
  }

  async function toggleMembership(empId: string, storeId: string, on: boolean) {
    const key = memberKey(empId, storeId);
    const prev = memberships;
    setMemberships((cur) => {
      const next = new Set(cur);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
    const { error: e } = on
      ? await supabase
          .from("store_members")
          .upsert(
            { employee_id: empId, store_id: storeId },
            { onConflict: "store_id,employee_id" }
          )
      : await supabase
          .from("store_members")
          .delete()
          .eq("employee_id", empId)
          .eq("store_id", storeId);
    if (e) {
      setMemberships(prev); // 失敗時は元の所属状態へ戻す
      setError(e.message);
    }
  }

  const active = useMemo(() => profiles.filter((p) => p.is_active), [profiles]);
  const inactive = useMemo(() => profiles.filter((p) => !p.is_active), [profiles]);

  if (loading)
    return <div className="p-8 text-center text-slate-500">読み込み中…</div>;
  if (error && profiles.length === 0)
    return <div className="p-8 text-center text-rose-600">{error}</div>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">従業員の管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          雇用形態と月の上限時間を設定すると、シフト作成時に上限超過を警告します。
        </p>
      </header>

      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold text-slate-700">在籍中</h2>
        {active.length === 0 ? (
          <p className="text-sm text-slate-400">在籍中の従業員はいません。</p>
        ) : (
          <ul className="space-y-2">
            {active.map((p) => (
              <Row
                key={p.id}
                p={p}
                isMe={p.id === meId}
                onUpdate={update}
                stores={stores}
                memberships={memberships}
                onToggleMembership={toggleMembership}
              />
            ))}
          </ul>
        )}
      </section>

      {inactive.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-slate-700">
            無効（退職など）
          </h2>
          <ul className="space-y-2">
            {inactive.map((p) => (
              <Row
                key={p.id}
                p={p}
                isMe={p.id === meId}
                onUpdate={update}
                stores={stores}
                memberships={memberships}
                onToggleMembership={toggleMembership}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({
  p,
  isMe,
  onUpdate,
  stores,
  memberships,
  onToggleMembership,
}: {
  p: Profile;
  isMe: boolean;
  onUpdate: (id: string, patch: Partial<Profile>) => void;
  stores: Store[];
  memberships: Set<string>;
  onToggleMembership: (empId: string, storeId: string, on: boolean) => void;
}) {
  const activeStores = stores.filter((s) => s.is_active);
  return (
    <li
      className={`rounded-xl border p-3 ${
        p.is_active ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* 氏名 */}
        <input
          type="text"
          defaultValue={p.full_name}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== p.full_name) onUpdate(p.id, { full_name: v });
          }}
          className="min-w-[8rem] flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-900"
        />
        {isMe && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
            自分
          </span>
        )}

        {/* 役割（自分は変更不可） */}
        <select
          value={p.role}
          disabled={isMe}
          onChange={(e) => onUpdate(p.id, { role: e.target.value as Profile["role"] })}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-400"
          title={isMe ? "自分の役割は変更できません" : ""}
        >
          <option value="employee">従業員</option>
          <option value="owner">オーナー</option>
        </select>

        {/* 雇用形態 */}
        <select
          value={p.employment_type}
          onChange={(e) =>
            onUpdate(p.id, {
              employment_type: e.target.value as Profile["employment_type"],
            })
          }
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
        >
          <option value="part_time">アルバイト・パート</option>
          <option value="regular">正社員</option>
        </select>

        {/* 月の上限時間 */}
        <label className="flex items-center gap-1 text-sm text-slate-500">
          上限
          <input
            type="number"
            min={0}
            step={1}
            defaultValue={p.max_hours_per_month ?? ""}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const val = raw === "" ? null : Number(raw);
              if (val !== p.max_hours_per_month)
                onUpdate(p.id, { max_hours_per_month: val });
            }}
            placeholder="—"
            className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
          />
          h/月
        </label>

        {/* 在籍トグル（自分は無効化不可） */}
        <button
          type="button"
          disabled={isMe}
          onClick={() => onUpdate(p.id, { is_active: !p.is_active })}
          className={`ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40 ${
            p.is_active
              ? "border border-slate-300 text-slate-600 hover:bg-slate-50"
              : "bg-emerald-600 text-white hover:bg-emerald-700"
          }`}
          title={isMe ? "自分を無効化することはできません" : ""}
        >
          {p.is_active ? "無効化" : "復帰"}
        </button>
      </div>

      {/* 所属店舗（従業員のみ。オーナーは全店舗を管理できるため割り当て不要） */}
      {p.role === "employee" && activeStores.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
          <span className="text-xs font-medium text-slate-500">所属店舗</span>
          {activeStores.map((s) => {
            const on = memberships.has(memberKey(p.id, s.id));
            return (
              <label
                key={s.id}
                className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                  on
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => onToggleMembership(p.id, s.id, e.target.checked)}
                  className="sr-only"
                />
                {s.name}
              </label>
            );
          })}
        </div>
      )}
    </li>
  );
}
