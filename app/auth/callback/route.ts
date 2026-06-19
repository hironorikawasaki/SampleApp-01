// app/auth/callback/route.ts
// マジックリンク・メール確認・パスワード再設定リンクの戻り先。
// URLの ?code= をセッションに交換してCookieに保存し、アプリへリダイレクトする。
//
// 重要:
//  1) Supabaseダッシュボード > Authentication > URL Configuration の
//     「Redirect URLs」に、このコールバックURL（本番・プレビュー・localhost）を
//     すべて登録すること。
//  2) middleware の PUBLIC_PATHS に "/auth" を含めること（未ログインで通すため）。
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabaseServer";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  // 遷移先（任意の next パラメータ）。オープンリダイレクト防止のため
  // 自サイト内の相対パスのみ許可。既定はトップ（/ で役割別に振り分け）。
  const rawNext = url.searchParams.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url.origin));
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth", url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
