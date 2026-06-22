"use client";

// =============================================================
// 共有シフトカレンダー（オーナー／従業員で共用）
//   - 月／半月（前半・後半）表示を切替
//   - 各日セルに出勤人数バッジ・備考インジケータ
//   - 日をタップすると、その日の出勤一覧（氏名・時間帯）＋日別備考を表示
//   - データは親が渡す（確定シフト・氏名解決・日別備考）。月の絞り込みは内部で行う。
// 依存: lib/shiftTime
// =============================================================

import { useMemo, useState } from "react";
import {
  WEEKDAYS,
  fromKey,
  toKey,
  timeLabel,
  hoursBetween,
  mdLabel,
} from "@/lib/shiftTime";

export interface CalendarShift {
  work_date: string;
  employee_id: string;
  start_time: string;
  end_time: string;
  position?: string | null;
}

type HalfMode = "full" | "first" | "second";

function buildWeeks(anchor: Date) {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const gridEnd = new Date(last);
  gridEnd.setDate(last.getDate() + (6 - last.getDay()));

  const weeks: { key: string; inMonth: boolean; day: number }[][] = [];
  const cur = new Date(gridStart);
  while (cur <= gridEnd) {
    const row: { key: string; inMonth: boolean; day: number }[] = [];
    for (let i = 0; i < 7; i++) {
      row.push({
        key: toKey(cur),
        inMonth: cur.getMonth() === month,
        day: cur.getDate(),
      });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(row);
  }
  return weeks;
}

function inHalf(day: number, half: HalfMode) {
  if (half === "first") return day <= 15;
  if (half === "second") return day >= 16;
  return true;
}

export default function ShiftCalendar({
  shifts,
  nameOf,
  dayNotes = {},
  highlightEmployeeId,
}: {
  shifts: CalendarShift[];
  nameOf: (employeeId: string) => string;
  dayNotes?: Record<string, string>;
  highlightEmployeeId?: string;
}) {
  const [anchor, setAnchor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [half, setHalf] = useState<HalfMode>("full");
  const [selected, setSelected] = useState<string | null>(null);

  const shiftsByDate = useMemo(() => {
    const m = new Map<string, CalendarShift[]>();
    for (const s of shifts) {
      const a = m.get(s.work_date) ?? [];
      a.push(s);
      m.set(s.work_date, a);
    }
    return m;
  }, [shifts]);

  const weeks = useMemo(() => buildWeeks(anchor), [anchor]);
  const monthLabel = `${anchor.getFullYear()}年${anchor.getMonth() + 1}月`;

  function shiftMonth(delta: number) {
    setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + delta, 1));
    setSelected(null);
  }

  const daySelected = selected ? shiftsByDate.get(selected) ?? [] : [];
  const headcount = (key: string) =>
    new Set((shiftsByDate.get(key) ?? []).map((s) => s.employee_id)).size;

  return (
    <div>
      {/* 月ナビ＋表示切替 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
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
        <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
          {(
            [
              ["full", "月"],
              ["first", "前半"],
              ["second", "後半"],
            ] as [HalfMode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setHalf(m);
                setSelected(null);
              }}
              className={`rounded-md px-3 py-1 transition ${
                half === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 曜日見出し */}
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

      {/* カレンダー本体 */}
      <div className="mt-1 grid grid-cols-7 gap-1">
        {weeks.flat().map(({ key, inMonth, day }) => {
          const active = inMonth && inHalf(day, half);
          if (!active) {
            return <div key={key} className="aspect-square" aria-hidden />;
          }
          const count = headcount(key);
          const hasNote = Boolean(dayNotes[key]);
          const isSel = key === selected;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelected(isSel ? null : key)}
              className={`relative flex aspect-square flex-col items-center justify-start rounded-xl border p-1 text-sm transition ${
                isSel
                  ? "border-slate-900 bg-slate-900 text-white"
                  : count > 0
                  ? "border-slate-300 bg-white text-slate-900 hover:border-slate-400"
                  : "border-slate-100 bg-slate-50 text-slate-400 hover:border-slate-300"
              }`}
            >
              <span className="mt-0.5">{day}</span>
              {hasNote && (
                <span
                  className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${
                    isSel ? "bg-amber-300" : "bg-amber-400"
                  }`}
                  aria-label="備考あり"
                />
              )}
              {count > 0 && (
                <span
                  className={`mt-auto mb-0.5 rounded-full px-1.5 text-[11px] font-semibold ${
                    isSel ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {count}人
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 日別ロスター */}
      {selected && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-800">
            {mdLabel(selected)} の出勤
            <span className="ml-2 text-xs font-normal text-slate-400">
              {headcount(selected)}人
            </span>
          </h3>
          {dayNotes[selected] && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {dayNotes[selected]}
            </p>
          )}
          {daySelected.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">出勤予定はありません。</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {daySelected
                .slice()
                .sort((a, b) =>
                  a.start_time !== b.start_time
                    ? a.start_time.localeCompare(b.start_time)
                    : nameOf(a.employee_id).localeCompare(nameOf(b.employee_id))
                )
                .map((s, i) => {
                  const me = s.employee_id === highlightEmployeeId;
                  return (
                    <li
                      key={`${s.employee_id}-${s.start_time}-${i}`}
                      className={`flex items-center justify-between rounded-lg border px-3 py-1.5 text-sm ${
                        me
                          ? "border-slate-900 bg-slate-50"
                          : "border-slate-100 bg-white"
                      }`}
                    >
                      <span className="truncate font-medium text-slate-800">
                        {nameOf(s.employee_id)}
                        {me && (
                          <span className="ml-1 text-[10px] text-slate-400">
                            あなた
                          </span>
                        )}
                        {s.position && (
                          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                            {s.position}
                          </span>
                        )}
                      </span>
                      <span className="ml-2 shrink-0 text-slate-500">
                        {timeLabel(s.start_time)}–{timeLabel(s.end_time)}
                        <span className="ml-1 text-xs text-slate-400">
                          {hoursBetween(s.start_time, s.end_time)}h
                        </span>
                      </span>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
