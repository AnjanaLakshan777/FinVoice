import { existsSync } from "node:fs";

import { defineConfig } from "prisma/config";

// Prisma CLI configuration (migrate, generate, seed). The running API does not read this file;
// it gets DATABASE_URL through @finvoice/config.
//
// For local development, load the repository-root .env if present. Variables already set in the
// environment (CI, containers, production) take precedence and are never overwritten.
const rootEnvFile = new URL("../../.env", import.meta.url);
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Optional so that `prisma generate` works without a database (e.g. during install).
  // Commands that need a database fail with a clear error when DATABASE_URL is missing.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
