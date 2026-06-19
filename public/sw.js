// public/sw.js
// 方針:
//  - ページ(ナビゲーション)はネットワーク優先。オフライン時のみ簡易フォールバック。
//    → 認証で保護されたページを古いまま表示する事故を防ぐ。
//  - 同一オリジンの静的GET(アイコン/_next/static等)はキャッシュ優先で高速化。
//  - APIや認証(/auth, supabase等)はキャッシュしない。

const CACHE = "shift-app-v1";
const PRECACHE = [
  "/icon-192.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

const OFFLINE_HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>オフライン</title>
<style>body{font-family:system-ui,sans-serif;background:#f1f5f9;color:#334155;
display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center}
div{padding:24px}</style></head>
<body><div><h1 style="font-size:18px">オフラインです</h1>
<p style="font-size:14px;color:#64748b">通信状況を確認して、もう一度お試しください。</p></div></body></html>`;

// ---- Web Push ------------------------------------------------
// サーバーからのプッシュを受け取り通知を表示する。
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "シフト管理";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
    tag: "shift-reminder", // 同種の通知は上書きして重複を防ぐ
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// 通知タップで該当ページを開く（既存タブがあれば再利用）。
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if (client.url.includes(target) && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
      })
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // 別オリジン(Supabase等)やAPI/認証は介入しない
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/auth")) return;

  // ページ遷移：ネットワーク優先、失敗時はオフライン表示
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(OFFLINE_HTML, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          })
      )
    );
    return;
  }

  // 静的アセット：キャッシュ優先、無ければ取得してキャッシュ
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
