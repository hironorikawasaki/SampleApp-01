import { describe, it, expect } from "vitest";
import {
  monthlyHoursByEmployee,
  monthLabel,
  roundedClockedHours,
  type ShiftHours,
} from "./hours";

const s = (
  employee_id: string,
  work_date: string,
  start_time: string,
  end_time: string
): ShiftHours => ({ employee_id, work_date, start_time, end_time });

describe("monthlyHoursByEmployee", () => {
  it("同一従業員・同一月の時間を合算する", () => {
    const r = monthlyHoursByEmployee([
      s("e1", "2026-06-17", "20:00", "23:00"), // 3h
      s("e1", "2026-06-18", "20:00", "00:00"), // 4h
    ]);
    expect(r.get("e1")?.get("2026-06")).toBe(7);
  });

  it("暦月をまたぐと別々に集計する（月上限の肝）", () => {
    const r = monthlyHoursByEmployee([
      s("e1", "2026-06-30", "20:00", "23:00"), // 6月 3h
      s("e1", "2026-07-01", "20:00", "23:00"), // 7月 3h
    ]);
    expect(r.get("e1")?.get("2026-06")).toBe(3);
    expect(r.get("e1")?.get("2026-07")).toBe(3);
  });

  it("日跨ぎ（深夜）の時間も正しく合算する", () => {
    const r = monthlyHoursByEmployee([
      s("e1", "2026-06-17", "22:00", "03:00"), // 5h
      s("e1", "2026-06-18", "20:00", "02:00"), // 6h
    ]);
    expect(r.get("e1")?.get("2026-06")).toBe(11);
  });

  it("従業員ごとに分けて集計する", () => {
    const r = monthlyHoursByEmployee([
      s("e1", "2026-06-17", "20:00", "23:00"),
      s("e2", "2026-06-17", "20:00", "22:00"),
    ]);
    expect(r.get("e1")?.get("2026-06")).toBe(3);
    expect(r.get("e2")?.get("2026-06")).toBe(2);
  });

  it("空配列は空のMap", () => {
    expect(monthlyHoursByEmployee([]).size).toBe(0);
  });
});

describe("monthLabel", () => {
  it("YYYY-MM を M月 にする", () => {
    expect(monthLabel("2026-06")).toBe("6月");
    expect(monthLabel("2026-12")).toBe("12月");
    expect(monthLabel("2026-01")).toBe("1月");
  });
});

describe("roundedClockedHours（出勤切上/退勤切捨・15分）", () => {
  it("出勤20:07→20:15, 退勤翌02:58→翌02:45 = 6.5h", () => {
    expect(
      roundedClockedHours(
        "2026-06-10T20:07:00+09:00",
        "2026-06-11T02:58:00+09:00"
      )
    ).toBe(6.5);
  });
  it("ちょうど15分境界はそのまま（20:00→翌03:00 = 7h）", () => {
    expect(
      roundedClockedHours(
        "2026-06-10T20:00:00+09:00",
        "2026-06-11T03:00:00+09:00"
      )
    ).toBe(7);
  });
  it("丸めで0以下になる短時間は 0（20:05→20:14 → 20:15〜20:00）", () => {
    expect(
      roundedClockedHours(
        "2026-06-10T20:05:00+09:00",
        "2026-06-10T20:14:00+09:00"
      )
    ).toBe(0);
  });
  it("退勤前(null)は 0", () => {
    expect(roundedClockedHours("2026-06-10T20:00:00+09:00", null)).toBe(0);
  });
});
