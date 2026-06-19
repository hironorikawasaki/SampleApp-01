// lib/config.ts
// 店舗ごとに変わる設定を環境変数から読み込む（方式B: 1デプロイ=1店舗の共有コア）。
// 各オーナーのデプロイで NEXT_PUBLIC_* を設定すると、コードを変えずに切り替えられる。
// 未設定でも既定値で従来どおり動作する。
//
// 重要: Next.js はクライアント側では `process.env.NEXT_PUBLIC_XXX` という
//       「リテラル参照」だけをビルド時に値へ置換する。動的キー（process.env[key]）
//       では置換されないため、ここでは必ず各変数を直接書いている。

export type ShiftPreset = { label: string; start: string; end: string };

// 営業時間内のワンタップ定番シフト（既定）。
// 店舗別に変える場合は NEXT_PUBLIC_SHIFT_PRESETS にJSON配列を設定する。
const DEFAULT_PRESETS: ShiftPreset[] = [
  { label: "通し", start: "20:00", end: "03:00" },
  { label: "前半", start: "20:00", end: "00:00" },
  { label: "後半", start: "00:00", end: "03:00" },
  { label: "20→翌1", start: "20:00", end: "01:00" },
  { label: "22→翌3", start: "22:00", end: "03:00" },
];

// 空文字・未設定なら既定値
function text(value: string | undefined, fallback: string): string {
  const v = value?.trim();
  return v ? v : fallback;
}

// 正の整数のみ採用。不正なら既定値
function posInt(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// JSON配列としてパースし、形が正しいときだけ採用。不正なら既定値
function parsePresets(value: string | undefined): ShiftPreset[] {
  if (!value?.trim()) return DEFAULT_PRESETS;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (p): p is ShiftPreset =>
          !!p &&
          typeof p.label === "string" &&
          typeof p.start === "string" &&
          typeof p.end === "string"
      )
    ) {
      return parsed;
    }
  } catch {
    // 不正なJSONは既定値にフォールバック
  }
  return DEFAULT_PRESETS;
}

export const config = {
  // 表示名
  brandName: text(process.env.NEXT_PUBLIC_BRAND_NAME, "シフト管理"), // アプリ名（PWA名・タイトル）
  storeName: text(process.env.NEXT_PUBLIC_STORE_NAME, "店舗名"), // ログイン画面の見出し

  // 営業時間（closeTime は翌日扱い。例 20:00〜翌03:00）
  openTime: text(process.env.NEXT_PUBLIC_OPEN_TIME, "20:00"),
  closeTime: text(process.env.NEXT_PUBLIC_CLOSE_TIME, "03:00"),
  slotMinutes: posInt(process.env.NEXT_PUBLIC_SLOT_MINUTES, 30),

  // 定番シフト
  shiftPresets: parsePresets(process.env.NEXT_PUBLIC_SHIFT_PRESETS),
} as const;
