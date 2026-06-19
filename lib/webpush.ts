// lib/webpush.ts
// サーバー専用：web-push の VAPID 設定を行い、設定済みインスタンスを返す。
// 環境変数:
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY … 公開鍵（クライアントの購読でも使用）
//   VAPID_PRIVATE_KEY            … 秘密鍵（サーバーのみ）
//   VAPID_SUBJECT               … 連絡先（mailto: か https URL）
import webpush from "web-push";

let configured = false;

export function getWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!publicKey || !privateKey) {
    throw new Error(
      "VAPID 鍵が未設定です（NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY）。"
    );
  }
  if (!configured) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  }
  return webpush;
}
