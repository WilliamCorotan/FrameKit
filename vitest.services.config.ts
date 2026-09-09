import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/db/src/*.integration.test.ts",
      "examples/crm/src/bootstrap.test.ts"
    ],
    pool: "forks",
    coverage: {
      provider: "v8",
      include: ["packages/db/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.integration.test.ts"],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60
      }
    }
  }
});
