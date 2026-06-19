import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// 純粋ロジック（lib/）の単体テスト用。DOM不要なので node 環境で実行する。
// tsconfig の "@/*" エイリアスをテストでも解決できるようにする。
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
