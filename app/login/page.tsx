// app/login/page.tsx
// useSearchParams を使うため Suspense で包む（App Routerの要件）。
import { Suspense } from "react";
import AuthScreen from "@/components/AuthScreen";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-slate-400">
          読み込み中…
        </div>
      }
    >
      <AuthScreen />
    </Suspense>
  );
}
