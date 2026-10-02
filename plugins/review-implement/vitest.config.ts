import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["_test_*.ts", "_test_*.tsx"] } });
