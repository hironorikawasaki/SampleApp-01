// lib/hours.ts
// 確定シフトの時間集計（純粋関数・テスト容易）。
// 月上限(max_hours_per_month)の比較に使うため、暦月(YYYY-MM)単位で合計する。
// 注意: 上限は「月」基準なので、提出期間(period)単位ではなく暦月で集計すること。
import { hoursBetween } from "./shiftTime";

export type ShiftHours = {
  employee_id: string;
  work_date: string; // 'YYYY-MM-DD'（営業日＝開店日）
  start_time: string;
  end_time: string;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// 従業員ごと × 暦月(YYYY-MM) ごとの合計時間。
//   work_date の先頭7文字(YYYY-MM)で月を判定する。
//   日跨ぎ(深夜)の時間補正は hoursBetween に委譲。
export function monthlyHoursByEmployee(
  shifts: ShiftHours[]
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const s of shifts) {
    const month = s.work_date.slice(0, 7);
    const h = hoursBetween(s.start_time, s.end_time);
    const byMonth = out.get(s.employee_id) ?? new Map<string, number>();
    byMonth.set(month, round1((byMonth.get(month) ?? 0) + h));
    out.set(s.employee_id, byMonth);
  }
  return out;
}

// 'YYYY-MM' → 'M月'（表示用）
export function monthLabel(ym: string): string {
  return `${Number(ym.slice(5, 7))}月`;
}

// 打刻（実時刻 timestamptz）からの実労働時間。退勤前(null)や不正は 0。0.1h 単位。
// 実時刻どうしの差なので日跨ぎの補正は不要。
export function clockedHours(
  clockIn: string,
  clockOut: string | null
): number {
  if (!clockOut) return 0;
  const ms = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return round1(ms / 3600000);
}
