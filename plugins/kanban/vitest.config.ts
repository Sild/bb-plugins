import { defineConfig } from "vitest/config";
export default defineConfig({
  define: { __BB_PLUGIN_ID__: JSON.stringify("kanban") },
  test: { include: ["_test_*.ts", "_test_*.tsx"] },
});
