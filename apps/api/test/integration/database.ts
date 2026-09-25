import { PrismaPg } from "@prisma/adapter-pg";
import { expect, inject } from "vitest";

import { Prisma, PrismaClient } from "../../src/generated/prisma/client.js";

export function createTestPrismaClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: inject("databaseUrl") }) });
}

/** Empties every domain table in the disposable test database. */
export async function truncateAllTables(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`TRUNCATE TABLE "financial_goals", "financial_profiles", "users"`;
}

/**
 * Asserts that PostgreSQL rejected a write. Prisma maps unique violations to P2002, foreign-key
 * violations to P2003, numeric overflow to P2020, CHECK violations to P2039, and any failure of a
 * raw query to P2010. P2039 and P2010 messages include the PostgreSQL message, which
 * names the violated constraint.
 */
export async function expectDatabaseError(
  write: Promise<unknown>,
  expected: { code: "P2002" | "P2003" | "P2010" | "P2020" | "P2039"; message?: string },
): Promise<void> {
  const error: unknown = await write.then(
    () => undefined,
    (caught: unknown) => caught,
  );

  expect(error, "expected the database to reject the write").toBeInstanceOf(
    Prisma.PrismaClientKnownRequestError,
  );
  const known = error as Prisma.PrismaClientKnownRequestError;
  expect(known.code).toBe(expected.code);
  if (expected.message !== undefined) {
    expect(known.message).toContain(expected.message);
  }
}

export function expectCheckViolation(write: Promise<unknown>, constraint: string): Promise<void> {
  return expectDatabaseError(write, { code: "P2039", message: constraint });
}
