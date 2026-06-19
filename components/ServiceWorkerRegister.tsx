"use client";

// components/ServiceWorkerRegister.tsx
// /sw.js を登録する。インストール可能性(Androidのインストールプロンプト)と
// オフライン時のフォールバックを有効化する。UIは描画しない。
import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // 本番のみ登録（開発中のキャッシュ事故を避ける）
    if (process.env.NODE_ENV !== "production") return;

    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 登録失敗は致命的ではないので握りつぶす
      });
    };
    // すでに load 済みなら即登録（load イベントの取りこぼしを防ぐ）
    if (document.readyState === "complete") {
      onLoad();
      return;
    }
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
