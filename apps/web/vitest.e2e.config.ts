import { defineConfig } from "vitest/config";

// Browser end-to-end tests (`pnpm test:e2e`): real Chrome/Edge against the production builds of
// the API and the web app and the local development database. Not part of `pnpm test`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
