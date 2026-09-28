/**
 * Deletes expired OTP challenges and expired auth sessions (see auth-cleanup.ts for the retention
 * periods).
 *
 * Run with `pnpm auth:cleanup` (development) or `node dist/auth/auth-cleanup.cli.js` (a built
 * deployment, for example from a scheduler). Safe to run repeatedly. It never runs at API startup,
 * never deletes an unexpired session, and prints only counts: no phone numbers, codes or tokens.
 */
import { loadApiConfig } from "@finvoice/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client.js";
import { deleteExpiredAuthData } from "./auth-cleanup.js";

async function main(): Promise<void> {
  const config = loadApiConfig();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.database.url }),
  });
  try {
    const result = await deleteExpiredAuthData(prisma);
    console.info(
      `Auth cleanup: deleted ${String(result.deletedOtpChallenges)} expired OTP challenges and ${String(result.deletedAuthSessions)} expired auth sessions.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  // The error class only: messages from the database driver can contain connection details.
  console.error(`Auth cleanup failed (${error instanceof Error ? error.name : "unknown error"}).`);
  process.exitCode = 1;
}
