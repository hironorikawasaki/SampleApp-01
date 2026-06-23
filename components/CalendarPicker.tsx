"use client";

// =============================================================
// カレンダー日付ピッカー（編集系オーナー画面の日付選択に使う）
//   - 月グリッドで日付を選択（rangeStart〜rangeEnd の範囲のみ選択可）
//   - 各日に任意のバッジ（件数など）を表示できる
//   - 選択は親が制御（selected / onSelect）。選んだ日の編集UIは親が下に描く。
// 依存: lib/shiftTime
// =============================================================

import { useMemo, useState } from "react";
import { WEEKDAYS, fromKey, monthWeeks } from "@/lib/shiftTime";

export default function CalendarPicker({
  selected,
  onSelect,
  rangeStart,
  rangeEnd,
  badge,
}: {
  selected: string | null;
  onSelect: (dateKey: string) => void;
  rangeStart: string;
  rangeEnd: string;
  badge?: (dateKey: string) => React.ReactNode;
}) {
  const [anchor, setAnchor] = useState(() => {
    const base = selected ?? rangeStart;
    const d = fromKey(base);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const weeks = useMemo(() => monthWeeks(anchor), [anchor]);
  const monthLabel = `${anchor.getFullYear()}年${anchor.getMonth() + 1}月`;

  function shiftMonth(delta: number) {
    setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + delta, 1));
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-center gap-1">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          aria-label="前の月"
        >
          ‹
        </button>
        <span className="min-w-[7rem] text-center text-sm font-bold text-slate-900">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          aria-label="次の月"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-400">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={i === 0 ? "text-rose-400" : i === 6 ? "text-sky-400" : ""}
          >
            {w}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {weeks.flat().map(({ key, inMonth, day }) => {
          const inRange = inMonth && key >= rangeStart && key <= rangeEnd;
          if (!inMonth) {
            return <div key={key} className="min-h-[4.75rem]" aria-hidden />;
          }
          const isSel = key === selected;
          return (
            <button
              key={key}
              type="button"
              disabled={!inRange}
              onClick={() => onSelect(key)}
              className={`flex min-h-[4.75rem] flex-col items-stretch rounded-xl border p-1 text-left text-sm transition ${
                isSel
                  ? "border-slate-900 bg-white text-slate-900 ring-2 ring-slate-900"
                  : inRange
                  ? "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                  : "cursor-default border-transparent bg-transparent text-slate-300"
              }`}
            >
              <span className="text-xs font-semibold">{day}</span>
              {inRange && badge && (
                <div className="mt-0.5 w-full overflow-hidden">{badge(key)}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
