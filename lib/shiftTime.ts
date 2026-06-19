// lib/shiftTime.ts
// 営業時間（config）に基づく時刻・日付ユーティリティ。
// availability / schedule / my-schedule で共通利用し、重複を排除する。
// 営業日の考え方: カレンダーの日付 = その日に開店する営業日。openTime より前の
// 時刻は「翌日側（深夜）」として扱う（例 20:00開店なら 02:00 は翌日扱い）。
import { config } from "./config";

export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

// 営業開始より前の時刻 = 日付を跨いだ深夜（翌日側）
export function isNextDay(t: string): boolean {
  return t.slice(0, 5) < config.openTime;
}

// 表示用：翌日側には「翌」を付ける
export function timeLabel(t: string | null): string {
  if (!t) return "";
  const v = t.slice(0, 5);
  return (isNextDay(v) ? "翌" : "") + v;
}

// 2時刻の勤務時間（日跨ぎ補正込み、0.1h単位）
export function hoursBetween(start: string, end: string): number {
  const toMin = (s: string) => {
    const [h, m] = s.slice(0, 5).split(":").map(Number);
    return h * 60 + m;
  };
  let diff = toMin(end) - toMin(start);
  if (diff <= 0) diff += 1440;
  return Math.round((diff / 60) * 10) / 10;
}

// 営業時間内の時間スロット（例 20:00,20:30,…,翌3:00）を生成。
// 既定は config（営業時間・刻み）に従う。
export function buildSlots(
  open: string = config.openTime,
  close: string = config.closeTime,
  step: number = config.slotMinutes
): string[] {
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  const fmt = (mins: number) => {
    const m = ((mins % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(
      m % 60
    ).padStart(2, "0")}`;
  };
  const slots: string[] = [];
  for (let m = toMin(open); m <= toMin(close) + 1440; m += step) slots.push(fmt(m));
  return slots;
}

// 既定の営業時間でのスロット（モジュール読み込み時に1度だけ生成）
export const TIME_SLOTS = buildSlots();

// ---- 日付ユーティリティ（端末ローカル日付で扱う）------------
export function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function todayKey(): string {
  return toKey(new Date());
}
// 'M/D(曜)' 形式
export function mdLabel(key: string): string {
  const d = fromKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}
// 'M月D日(曜)' 形式
export function fullDate(key: string): string {
  const d = fromKey(key);
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`;
}
// 今日からの相対表現（今日/明日/明後日 のみ、他は null）
export function relativeDay(key: string): string | null {
  const diff = Math.round(
    (fromKey(key).getTime() - fromKey(todayKey()).getTime()) / 86400000
  );
  if (diff === 0) return "今日";
  if (diff === 1) return "明日";
  if (diff === 2) return "明後日";
  return null;
}

// 営業日(開店日)のキーを返す。深夜(closeTime より前)の打刻は前日の営業日に属する。
//   例: 営業 20:00〜翌03:00 のとき、02:00 の打刻 → 前日の営業日。
//   境界は closeTime（閉店〜開店の「営業していない時間帯」で日替わり）。
export function businessDayKey(now: Date): string {
  const [ch, cm] = config.closeTime.split(":").map(Number);
  const closeMin = ch * 60 + cm;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const d = new Date(now);
  if (nowMin < closeMin) d.setDate(d.getDate() - 1);
  return toKey(d);
}

// 'HH:MM'（時刻のみ）。打刻時刻の表示に使う。
export function clockLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

// ISO(UTC) → datetime-local 入力用のローカル文字列 'YYYY-MM-DDTHH:mm'
export function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

// datetime-local（端末ローカル時刻）→ ISO(UTC)
export function datetimeLocalToIso(local: string): string {
  return new Date(local).toISOString();
}
