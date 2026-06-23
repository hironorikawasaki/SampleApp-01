// (app) 配下の画面遷移中に即時表示されるスケルトン（Suspense フォールバック）。
import { PageSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return <PageSkeleton />;
}
