// 画面遷移・データ取得中に表示するスケルトン（プレースホルダ）。
// 純粋な見た目だけのコンポーネント（フック無し）。

// リスト系画面（見出し＋ツールバー＋行）用
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6" aria-hidden>
      <div className="mb-5 h-7 w-40 animate-pulse rounded bg-slate-200" />
      <div className="mb-4 flex gap-2">
        <div className="h-9 w-32 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-9 w-24 animate-pulse rounded-lg bg-slate-200" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-xl bg-slate-100"
          />
        ))}
      </div>
    </div>
  );
}

// カレンダー系画面（見出し＋7列グリッド）用
export function CalendarSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6" aria-hidden>
      <div className="mb-3 flex items-center justify-between">
        <div className="h-7 w-32 animate-pulse rounded bg-slate-200" />
        <div className="h-8 w-28 animate-pulse rounded-lg bg-slate-200" />
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 35 }).map((_, i) => (
          <div
            key={i}
            className="min-h-[4.75rem] animate-pulse rounded-xl bg-slate-100"
          />
        ))}
      </div>
    </div>
  );
}
