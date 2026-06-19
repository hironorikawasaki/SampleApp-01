"use client";

// =============================================================
// ボトムナビゲーション
//   - 従業員: 希望提出(/availability) / シフト確認(/my-schedule)
//   - オーナー: シフト作成(/schedule)
//   - 共通: ログアウト
//   役割は layout から role プロップで受け取る
// 依存: @/lib/supabaseClient, next/navigation, next/link
// =============================================================

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Role = "employee" | "owner";
type Item = { href: string; label: string; icon: React.ReactNode };

export default function AppNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const router = useRouter();

  const items: Item[] =
    role === "owner"
      ? [
          { href: "/schedule", label: "シフト作成", icon: <GridIcon /> },
          { href: "/timecards", label: "勤怠", icon: <ClockIcon /> },
          { href: "/employees", label: "従業員管理", icon: <UsersIcon /> },
          { href: "/stores", label: "店舗管理", icon: <StoreIcon /> },
        ]
      : [
          { href: "/availability", label: "希望提出", icon: <CalendarIcon /> },
          { href: "/my-schedule", label: "シフト確認", icon: <CheckIcon /> },
          { href: "/attendance", label: "出退勤", icon: <ClockIcon /> },
        ];

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md items-stretch justify-around">
        {items.map((it) => {
          const active =
            pathname === it.href || pathname.startsWith(it.href + "/");
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition ${
                active ? "text-slate-900" : "text-slate-400"
              }`}
            >
              {it.icon}
              {it.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={signOut}
          className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-slate-400 transition hover:text-slate-600"
        >
          <LogoutIcon />
          ログアウト
        </button>
      </div>
    </nav>
  );
}

// ---- アイコン（依存なしのインラインSVG）----------------------
const base = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function CalendarIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg {...base}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function StoreIcon() {
  return (
    <svg {...base}>
      <path d="M3 9l1.5-5h15L21 9M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9M3 9h18" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg {...base}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg {...base}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
