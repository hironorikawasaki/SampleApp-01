// middleware.ts （プロジェクト直下に配置）
// 役割:
//  - 全リクエストでセッションをリフレッシュ
//  - 未ログインで保護対象ページにアクセス → /login へ
//  - ログイン済みで /login にアクセス → / へ（/ で役割別に振り分け）
//
// 注意: Next.js 16 以降では middleware が "proxy" に名称変更されています。
//       その場合はファイル名・関数名を proxy に読み替えてください。
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// 認証なしでアクセスできるパス
// /api は各ルートハンドラ側で認証する（cron はトークン認証のためログイン不要）
const PUBLIC_PATHS = ["/login", "/auth", "/api"];

export async function middleware(request: NextRequest) {
  // このレスポンスにCookieを書き込み、最終的に返す（公式パターン）
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() は必ず呼ぶ（セッションのリフレッシュを兼ねる）
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some(
    (p) => path === p || path.startsWith(p + "/")
  );

  // 未ログイン & 保護対象 → /login へ
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return copyCookies(NextResponse.redirect(url), supabaseResponse);
  }

  // ログイン済み & /login → トップへ（/ で役割別に振り分け）
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return copyCookies(NextResponse.redirect(url), supabaseResponse);
  }

  return supabaseResponse;
}

// リダイレクト時もリフレッシュ済みCookieを引き継ぐ（セッション喪失防止）
function copyCookies(res: NextResponse, from: NextResponse) {
  from.cookies.getAll().forEach((c) => res.cookies.set(c));
  return res;
}

export const config = {
  // 静的アセット・Service Worker・マニフェストは保護対象外にする
  // （/sw.js を保護すると SW スクリプト取得が /login にリダイレクトされ、
  //   プッシュ通知もオフラインキャッシュも動かなくなるため必ず除外する）
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
