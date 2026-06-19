import { describe, it, expect } from "vitest";
import {
  text,
  posInt,
  parsePresets,
  DEFAULT_PRESETS,
  config,
} from "./config";

describe("text", () => {
  it("値があればそのまま（前後空白は除去）", () => {
    expect(text("Club ○○", "既定")).toBe("Club ○○");
    expect(text("  店名  ", "既定")).toBe("店名");
  });
  it("未設定・空文字・空白のみは既定値", () => {
    expect(text(undefined, "既定")).toBe("既定");
    expect(text("", "既定")).toBe("既定");
    expect(text("   ", "既定")).toBe("既定");
  });
});

describe("posInt", () => {
  it("正の整数のみ採用", () => {
    expect(posInt("30", 30)).toBe(30);
    expect(posInt("15", 30)).toBe(15);
  });
  it("0・負数・非整数・非数値・未設定は既定値", () => {
    expect(posInt("0", 30)).toBe(30);
    expect(posInt("-5", 30)).toBe(30);
    expect(posInt("3.5", 30)).toBe(30);
    expect(posInt("abc", 30)).toBe(30);
    expect(posInt(undefined, 30)).toBe(30);
  });
});

describe("parsePresets", () => {
  it("未設定なら既定プリセット", () => {
    expect(parsePresets(undefined)).toBe(DEFAULT_PRESETS);
    expect(parsePresets("")).toBe(DEFAULT_PRESETS);
  });
  it("不正なJSONは既定値にフォールバック", () => {
    expect(parsePresets("{not json")).toBe(DEFAULT_PRESETS);
  });
  it("形が違う配列も既定値にフォールバック", () => {
    expect(parsePresets('[{"label":"x"}]')).toBe(DEFAULT_PRESETS);
    expect(parsePresets('"a string"')).toBe(DEFAULT_PRESETS);
  });
  it("正しい形なら採用する", () => {
    const json = '[{"label":"通し","start":"19:00","end":"02:00"}]';
    expect(parsePresets(json)).toEqual([
      { label: "通し", start: "19:00", end: "02:00" },
    ]);
  });
});

describe("config（既定値・環境変数未設定時）", () => {
  it("既定の表示名・営業時間・刻み", () => {
    expect(config.brandName).toBe("シフト管理");
    expect(config.storeName).toBe("店舗名");
    expect(config.openTime).toBe("20:00");
    expect(config.closeTime).toBe("03:00");
    expect(config.slotMinutes).toBe(30);
  });
  it("既定プリセットは5種", () => {
    expect(config.shiftPresets).toHaveLength(5);
  });
});
