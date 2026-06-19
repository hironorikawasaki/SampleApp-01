// app/layout.tsx （ルートレイアウト）
// PWAのメタ情報（apple-touch-icon, apple用メタ, theme-color）を設定し、
// Service Worker を登録する。
import type { Metadata, Viewport } from "next";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import "./globals.css"; // Tailwind等のグローバルCSS（プロジェクトに合わせて）

export const metadata: Metadata = {
  title: "シフト管理",
  description: "希望シフトの提出と確認ができるアプリ",
  // iOSでホーム画面に追加したときの挙動
  appleWebApp: {
    capable: true,
    title: "シフト管理",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // ノッチ/ホームバー領域まで利用
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
