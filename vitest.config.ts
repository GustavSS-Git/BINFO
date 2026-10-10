import { defineConfig } from "vitest/config";
import path from "node:path";

// Standalone from vite.config.ts on purpose — that file is owned by the
// @lovable.dev/vite-tanstack-config wrapper, which warns against adding
// plugins manually. The pure calc layer needs nothing from it but the
// "@/" alias.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // Agent worktrees under .claude/ hold full copies of the suite.
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**"],
  },
});
