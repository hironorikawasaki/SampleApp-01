"use client";

// =============================================================
// ログイン / 新規登録 画面（Supabase Auth）
//   - メール＋パスワード（ログイン・新規登録）
//   - マジックリンク（パスワード不要のメールログイン）
//   - ログイン後は役割で振り分け：owner→/schedule, employee→/availability
//   - 新規登録は full_name を渡し、DBトリガーが profiles を自動作成
// 依存: @/lib/supabaseClient, next/navigation
// 設置例: app/login/page.tsx から本コンポーネントを表示
// =============================================================

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

// 店舗名はここを変更（ヘッダー表示用）
const STORE_NAME = "店舗名";

type Mode = "signin" | "signup";
type Method = "password" | "magic";

export default function AuthScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("signin");
  const [method, setMethod] = useState<Method>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // 役割に応じて遷移先を決めて移動
  async function routeByRole() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    router.replace(data?.role === "owner" ? "/schedule" : "/availability");
    return true;
  }

  // すでにログイン済みなら入口を飛ばす
  useEffect(() => {
    (async () => {
      const routed = await routeByRole();
      if (!routed) setChecking(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // コールバックから戻ってきたときのエラー表示（/login?error=...）
  useEffect(() => {
    const code = searchParams.get("error");
    if (code) setError(mapCallbackError(code));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function resetMessages() {
    setError(null);
    setInfo(null);
  }

  async function handleSubmit() {
    resetMessages();
    if (!email) return setError("メールアドレスを入力してください。");

    setLoading(true);
    try {
      if (method === "magic") {
        const { error: e } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo:
              typeof window !== "undefined"
                ? `${window.location.origin}/auth/callback`
                : undefined,
            // 新規登録モードのときだけ名前をメタデータに保存
            data: mode === "signup" && fullName ? { full_name: fullName } : undefined,
          },
        });
        if (e) throw e;
        setInfo("ログイン用のリンクをメールに送りました。メールを開いて続けてください。");
        return;
      }

      if (mode === "signin") {
        const { error: e } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (e) throw e;
        await routeByRole();
      } else {
        if (!fullName.trim())
          return setError("お名前を入力してください。");
        const { data, error: e } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName.trim() },
            emailRedirectTo:
              typeof window !== "undefined"
                ? `${window.location.origin}/auth/callback`
                : undefined,
          },
        });
        if (e) throw e;
        // メール確認が有効な場合はセッションが無い
        if (data.session) {
          await routeByRole();
        } else {
          setInfo(
            "確認メールを送りました。メール内のリンクを開くと登録が完了します。"
          );
        }
      }
    } catch (e: any) {
      setError(translateError(e?.message ?? "エラーが発生しました。"));
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        読み込み中…
      </div>
    );
  }

  const showPassword = method === "password";
  const showName = mode === "signup";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm">
        {/* ブランド */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {STORE_NAME}
          </h1>
          <p className="mt-1 text-sm text-slate-500">シフト管理</p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          {/* ログイン / 新規登録 切替 */}
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium">
            {(["signin", "signup"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  resetMessages();
                }}
                className={`rounded-md py-2 transition ${
                  mode === m
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500"
                }`}
              >
                {m === "signin" ? "ログイン" : "新規登録"}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {showName && (
              <Field label="お名前">
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="山田 太郎"
                  autoComplete="name"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none"
                />
              </Field>
            )}

            <Field label="メールアドレス">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none"
              />
            </Field>

            {showPassword && (
              <Field label="パスワード">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="6文字以上"
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none"
                />
              </Field>
            )}

            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            )}
            {info && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {info}
              </p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {loading
                ? "処理中…"
                : method === "magic"
                ? "ログインリンクを送る"
                : mode === "signin"
                ? "ログイン"
                : "登録する"}
            </button>
          </div>

          {/* ログイン方法の切替 */}
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setMethod(method === "password" ? "magic" : "password");
                resetMessages();
              }}
              className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
            >
              {method === "password"
                ? "パスワードなしでログイン（メールのリンク）"
                : "パスワードでログインに戻る"}
            </button>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          新規登録した方は、最初は従業員として登録されます。
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

// コールバック(/auth/callback)が返すエラーコードを日本語に
function mapCallbackError(code: string): string {
  switch (code) {
    case "auth":
      return "ログインリンクの確認に失敗しました。リンクの有効期限が切れている可能性があります。もう一度お試しください。";
    case "missing_code":
      return "リンクが正しくありません。メールのリンクをもう一度開いてください。";
    default:
      return "認証中にエラーが発生しました。もう一度お試しください。";
  }
}

// よくあるSupabaseのエラーを日本語に
function translateError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials"))
    return "メールアドレスかパスワードが正しくありません。";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "このメールアドレスは既に登録されています。ログインをお試しください。";
  if (m.includes("password should be at least"))
    return "パスワードは6文字以上にしてください。";
  if (m.includes("email not confirmed"))
    return "メールの確認が完了していません。確認メールのリンクを開いてください。";
  if (m.includes("unable to validate email") || m.includes("invalid email"))
    return "メールアドレスの形式が正しくありません。";
  if (m.includes("rate limit") || m.includes("too many"))
    return "試行回数が多すぎます。少し時間をおいて再度お試しください。";
  return msg;
}
