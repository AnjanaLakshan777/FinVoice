/**
 * Deletes expired auth sessions and guest accounts nobody can sign in to any more (see
 * auth-cleanup.ts for the rules).
 *
 * Run with `pnpm auth:cleanup` (development) or `node dist/auth/auth-cleanup.cli.js` (a built
 * deployment, for example from a scheduler). Safe to run repeatedly. It never runs at API startup,
 * never deletes an unexpired session or an ADMIN account, and prints only counts.
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
      `Auth cleanup: deleted ${String(result.deletedAuthSessions)} expired auth sessions and ${String(result.deletedGuestAccounts)} guest accounts without a usable session.`,
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
