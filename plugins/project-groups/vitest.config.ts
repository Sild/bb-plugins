import { defineConfig } from "vitest/config";
export default defineConfig({
  define: { __BB_PLUGIN_ID__: JSON.stringify("project-groups") },
  test: { environment: "jsdom", include: ["_test_*.tsx", "_test_*.ts"] },
});
