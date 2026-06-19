import { describe, it, expect } from "vitest";
import { monthlyHoursByEmployee, monthLabel, type ShiftHours } from "./hours";

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
