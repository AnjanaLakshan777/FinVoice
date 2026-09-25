import { configDefaults, defineConfig } from "vitest/config";

// Unit tests: no external services required. Database tests live in test/integration and run
// through vitest.integration.config.ts.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "test/integration/**"],
    // Booting the Nest application can exceed the 10 s default when every workspace's tests run
    // in parallel on a busy machine.
    hookTimeout: 30_000,
  },
});
