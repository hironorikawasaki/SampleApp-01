// app/manifest.ts
// Next.js が /manifest.webmanifest を自動生成し、<link rel="manifest"> も自動挿入します。
// アイコンは public/ 直下に配置してください。
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "シフト管理", // ホーム画面の正式名（store名に変更可）
    short_name: "シフト",
    description: "希望シフトの提出と確認ができるアプリ",
    start_url: "/",
    scope: "/",
    display: "standalone", // アドレスバーなしの全画面起動
    orientation: "portrait",
    background_color: "#f1f5f9", // 起動スプラッシュの背景（slate-100）
    theme_color: "#0f172a", // ツールバー色（slate-900）
    lang: "ja",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
