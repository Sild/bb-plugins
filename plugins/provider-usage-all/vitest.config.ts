import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["_test_*.tsx"] }, esbuild: { jsx: "automatic" } });
