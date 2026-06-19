import { describe, it, expect } from "vitest";
import {
  isNextDay,
  timeLabel,
  hoursBetween,
  buildSlots,
  TIME_SLOTS,
  toKey,
  fromKey,
  todayKey,
  mdLabel,
  fullDate,
  relativeDay,
} from "./shiftTime";

// 既定 config（openTime=20:00 / closeTime=03:00 / 30分刻み）前提のテスト。

describe("isNextDay", () => {
  it("営業開始(20:00)より前は翌日扱い", () => {
    expect(isNextDay("02:00")).toBe(true);
    expect(isNextDay("19:59")).toBe(true);
    expect(isNextDay("00:00")).toBe(true);
  });
  it("営業開始以降は当日扱い", () => {
    expect(isNextDay("20:00")).toBe(false);
    expect(isNextDay("23:30")).toBe(false);
  });
});

describe("timeLabel", () => {
  it("秒を落として HH:MM にする", () => {
    expect(timeLabel("20:00:00")).toBe("20:00");
  });
  it("翌日側には「翌」を付ける", () => {
    expect(timeLabel("02:00")).toBe("翌02:00");
  });
  it("null は空文字", () => {
    expect(timeLabel(null)).toBe("");
  });
});

describe("hoursBetween", () => {
  it("同日内の差", () => {
    expect(hoursBetween("20:00", "23:00")).toBe(3);
  });
  it("日跨ぎ（22:00→翌03:00 = 5h）", () => {
    expect(hoursBetween("22:00", "03:00")).toBe(5);
  });
  it("0:00をまたぐ（20:00→00:00 = 4h）", () => {
    expect(hoursBetween("20:00", "00:00")).toBe(4);
  });
  it("開始と終了が同じなら24h扱い", () => {
    expect(hoursBetween("20:00", "20:00")).toBe(24);
  });
  it("秒付きでも計算できる", () => {
    expect(hoursBetween("20:00:00", "20:30:00")).toBe(0.5);
  });
});

describe("buildSlots / TIME_SLOTS", () => {
  it("既定スロットは20:00開始・03:00終了で15個", () => {
    expect(TIME_SLOTS[0]).toBe("20:00");
    expect(TIME_SLOTS[TIME_SLOTS.length - 1]).toBe("03:00");
    expect(TIME_SLOTS).toHaveLength(15);
    expect(TIME_SLOTS).toContain("00:00");
  });
  it("刻みを変えられる（60分なら8個）", () => {
    const slots = buildSlots("20:00", "03:00", 60);
    expect(slots).toEqual([
      "20:00",
      "21:00",
      "22:00",
      "23:00",
      "00:00",
      "01:00",
      "02:00",
      "03:00",
    ]);
  });
});

describe("toKey / fromKey", () => {
  it("往復で一致する", () => {
    const d = new Date(2026, 5, 19); // 2026-06-19（ローカル）
    expect(toKey(d)).toBe("2026-06-19");
    expect(toKey(fromKey("2026-06-19"))).toBe("2026-06-19");
  });
  it("月日をゼロ埋めする", () => {
    expect(toKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("mdLabel / fullDate", () => {
  it("M/D(曜) 形式", () => {
    // 2026-06-19 は金曜
    expect(mdLabel("2026-06-19")).toBe("6/19(金)");
  });
  it("M月D日(曜) 形式", () => {
    expect(fullDate("2026-06-19")).toBe("6月19日(金)");
  });
});

describe("relativeDay", () => {
  it("今日は「今日」", () => {
    expect(relativeDay(todayKey())).toBe("今日");
  });
  it("3日以上先は null", () => {
    const d = fromKey(todayKey());
    d.setDate(d.getDate() + 5);
    expect(relativeDay(toKey(d))).toBeNull();
  });
});
