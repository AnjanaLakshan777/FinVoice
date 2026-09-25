import { defineConfig } from "vitest/config";

// Database integration tests. Requires a running Docker engine: the global setup starts a
// disposable PostgreSQL container, applies all migrations, and removes the container afterwards.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    globalSetup: ["test/integration/global-setup.ts"],
    // All files share one database and reset it between tests, so they must not run concurrently.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
