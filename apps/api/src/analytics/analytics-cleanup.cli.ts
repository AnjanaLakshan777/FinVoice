/**
 * Deletes analytics events older than ANALYTICS_RETENTION_DAYS (default 90).
 *
 * Run with `pnpm analytics:cleanup` (development) or `node dist/analytics/analytics-cleanup.cli.js`
 * (a built deployment, for example from a scheduler). Safe to run repeatedly. It never runs at API
 * startup, deletes analytics events only, and prints only the number of deleted events.
 */
import { loadApiConfig } from "@finvoice/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client.js";
import { deleteExpiredAnalyticsEvents } from "./analytics-cleanup.js";

async function main(): Promise<void> {
  const config = loadApiConfig();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.database.url }),
  });
  try {
    const { deleted, cutoff } = await deleteExpiredAnalyticsEvents(
      prisma,
      config.analytics.retentionDays,
    );
    console.info(
      `Analytics cleanup: deleted ${String(deleted)} events older than ${String(config.analytics.retentionDays)} days (before ${cutoff.toISOString()}).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  // The error class only: messages from the database driver can contain connection details.
  console.error(
    `Analytics cleanup failed (${error instanceof Error ? error.name : "unknown error"}).`,
  );
  process.exitCode = 1;
}
