"use client";

// =============================================================
// 希望提出リマインドバナー（アプリ内通知）
//   - 「受付中・締切前・未提出」の期間を (app)/layout.tsx がサーバー側で算出し、
//     このクライアントコンポーネントに渡す。
//   - 締切まで24時間以内は赤（緊急）、それ以外は黄で表示。
//   - ✕ で閉じると sessionStorage に記録し、そのセッション中は再表示しない
//     （タブを閉じれば次回また表示＝リマインドの意図）。
// =============================================================

import { useEffect, useState } from "react";
import Link from "next/link";

export interface ReminderPeriod {
  id: string;
  title: string;
  submission_deadline: string;
}

const DISMISS_KEY = "shift-reminder-dismissed";

export default function SubmissionReminder({
  periods,
}: {
  periods: ReminderPeriod[];
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DISMISS_KEY);
      setDismissed(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    } catch {
      /* sessionStorage が使えない環境は無視 */
    }
    setReady(true);
  }, []);

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      try {
        sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
      } catch {
        /* 保存できなくても表示制御は継続 */
      }
      return next;
    });
  }

  // ハイドレーション差異を避けるため、読み込み完了まで描画しない
  if (!ready) return null;
  const visible = periods.filter((p) => !dismissed.has(p.id));
  if (visible.length === 0) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-2 px-4 pt-4">
      {visible.map((p) => {
        const info = deadlineInfo(p.submission_deadline);
        return (
          <div
            key={p.id}
            role="status"
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
              info.urgent
                ? "border-rose-200 bg-rose-50"
                : "border-amber-200 bg-amber-50"
            }`}
          >
            <span className="mt-0.5 text-lg" aria-hidden>
              {info.urgent ? "⏰" : "📝"}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm font-semibold ${
                  info.urgent ? "text-rose-800" : "text-amber-800"
                }`}
              >
                「{p.title}」の希望シフトが未提出です
              </p>
              <p
                className={`mt-0.5 text-xs ${
                  info.urgent ? "text-rose-700" : "text-amber-700"
                }`}
              >
                提出締切：{info.label}
              </p>
              <Link
                href="/availability"
                className="mt-2 inline-block rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
              >
                希望を提出する
              </Link>
            </div>
            <button
              type="button"
              onClick={() => dismiss(p.id)}
              className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-600"
              aria-label="閉じる"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

// 締切までの残り時間から、緊急フラグと表示ラベルを作る
function deadlineInfo(iso: string): { urgent: boolean; label: string } {
  const deadline = new Date(iso);
  const ms = deadline.getTime() - Date.now();
  const hours = ms / (1000 * 60 * 60);
  const days = Math.floor(hours / 24);
  const dateLabel = deadline.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  let remain: string;
  if (hours <= 1) remain = "まもなく締切";
  else if (hours < 24) remain = `あと約${Math.ceil(hours)}時間`;
  else remain = `あと${days}日`;
  return { urgent: hours <= 24, label: `${dateLabel}（${remain}）` };
}
