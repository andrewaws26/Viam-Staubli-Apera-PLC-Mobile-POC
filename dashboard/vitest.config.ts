import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      // Only measure coverage for library code, not tests/config/mocks
      include: ["lib/**/*.ts", "hooks/**/*.ts"],
      exclude: ["tests/**", "**/*.test.ts", "**/*.d.ts"],
      reporter: ["text", "text-summary"],
      // Thresholds — baseline from current state, ratchet up as coverage improves
      thresholds: {
        lines: 25,
        functions: 20,
        branches: 20,
        statements: 25,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@ironsight/shared": path.resolve(__dirname, "../packages/shared/src"),
    },
  },
});
