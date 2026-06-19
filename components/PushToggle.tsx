"use client";

// =============================================================
// Web Push 有効化トグル（従業員向け）
//   - 通知が「未許可(default)」のときだけ、有効化を促すバナーを表示。
//   - ボタンで Notification 許可 → PushManager 購読 → サーバーに保存。
//   - 許可済みで購読も存在すれば何も表示しない。拒否(denied)・非対応・
//     VAPID未設定のときも表示しない。
//   - ✕ で閉じるとそのセッション中は非表示（sessionStorage）。
// 注意: Service Worker は本番のみ登録されるため、購読は本番(HTTPS)で有効。
// =============================================================

import { useEffect, useState } from "react";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const DISMISS_KEY = "push-toggle-dismissed";

type State = "loading" | "hidden" | "prompt" | "subscribed";

export default function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 非対応 / VAPID未設定 / セッション中に閉じた → 出さない
    if (
      !VAPID_PUBLIC_KEY ||
      typeof window === "undefined" ||
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setState("hidden");
      return;
    }
    try {
      if (sessionStorage.getItem(DISMISS_KEY)) {
        setState("hidden");
        return;
      }
    } catch {
      /* ignore */
    }

    const perm = Notification.permission;
    if (perm === "denied") {
      setState("hidden");
      return;
    }
    if (perm === "granted") {
      // 既に購読済みなら出さない。未購読なら有効化を促す。
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => reg?.pushManager.getSubscription())
        .then((sub) => setState(sub ? "subscribed" : "prompt"))
        .catch(() => setState("prompt"));
      return;
    }
    setState("prompt"); // default
  }, []);

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setState("hidden");
  }

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setError(
          perm === "denied"
            ? "通知がブロックされています。ブラウザの設定から許可してください。"
            : "通知が許可されませんでした。"
        );
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setError(
          "通知は本番環境（HTTPS・インストール済みPWA）で有効になります。"
        );
        return;
      }
      const ready = await navigator.serviceWorker.ready;
      const existing = await ready.pushManager.getSubscription();
      const sub =
        existing ??
        (await ready.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
        }));

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error("save_failed");
      setState("subscribed");
    } catch {
      setError("通知を有効にできませんでした。時間をおいて再度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" || state === "hidden" || state === "subscribed") {
    return null;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4">
      <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
        <span className="mt-0.5 text-lg" aria-hidden>
          🔔
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-sky-900">
            提出忘れの通知を受け取りますか？
          </p>
          <p className="mt-0.5 text-xs text-sky-700">
            オンにすると、締切が近い未提出のシフト希望を端末にお知らせします。
          </p>
          {error && (
            <p className="mt-1 text-xs text-rose-700">{error}</p>
          )}
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="mt-2 inline-block rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? "設定中…" : "通知をオンにする"}
          </button>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-600"
          aria-label="閉じる"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// VAPID公開鍵(base64url) を applicationServerKey 用の Uint8Array に変換
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
