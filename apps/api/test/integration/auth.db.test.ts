import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  AUTH_SESSION_RETENTION_DAYS,
  deleteExpiredAuthData,
  ORPHANED_GUEST_MIN_AGE_DAYS,
} from "../../src/auth/auth-cleanup.js";
import {
  createTestPrismaClient,
  expectCheckViolation,
  expectDatabaseError,
  truncateAllTables,
} from "./database.js";

const DAY = 86_400_000;
const HASH = "a".repeat(64);
const prisma = createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAllTables(prisma);
});

function createUser(overrides: Record<string, unknown> = {}) {
  return prisma.user.create({ data: { preferredLanguage: "EN", ...overrides } });
}

async function session(overrides: Record<string, unknown> = {}) {
  const user = (await prisma.user.findFirst()) ?? (await createUser());
  const now = new Date();
  return prisma.authSession.create({
    data: {
      userId: user.id,
      tokenFamilyId: randomUUID(),
      refreshTokenHash: randomUUID().replaceAll("-", "").repeat(2),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * DAY),
      ...overrides,
    },
  });
}

describe("users.role", () => {
  it("defaults to USER and accepts only USER or ADMIN", async () => {
    const user = await createUser();

    expect(user.role).toBe("USER");
    await expectDatabaseError(
      prisma.$executeRaw`UPDATE users SET role = 'OWNER' WHERE id = ${user.id}::uuid`,
      { code: "P2010", message: "user_role" },
    );
  });
});

describe("auth_sessions constraints", () => {
  it("keeps the refresh token hash unique", async () => {
    await session({ refreshTokenHash: HASH });

    await expectDatabaseError(session({ refreshTokenHash: HASH }), { code: "P2002" });
  });

  it.each([
    ["refresh_token_hash_format_check", { refreshTokenHash: "x".repeat(64) }],
    ["expires_after_created_check", { expiresAt: new Date(Date.now() - 1000) }],
    ["replaced_is_revoked_check", { replacedBySessionId: randomUUID() }],
    [
      "grace_reuse_requires_replacement_check",
      { revokedAt: new Date(), graceReusedAt: new Date() },
    ],
  ])("enforces %s", async (constraint, overrides) => {
    await expectCheckViolation(session(overrides), `auth_sessions_${constraint}`);
  });

  it("requires an existing user, and disappears with the user", async () => {
    await expectDatabaseError(session({ userId: randomUUID() }), { code: "P2003" });

    const created = await session();
    await prisma.user.delete({ where: { id: created.userId } });

    expect(await prisma.authSession.count()).toBe(0);
  });
});

describe("auth cleanup", () => {
  it("deletes only sessions past their retention period", async () => {
    const now = new Date();
    const ago = (days: number, extraMs = 0) => new Date(now.getTime() - days * DAY - extraMs);
    const created = (expiresAt: Date) => new Date(expiresAt.getTime() - 60_000);

    // Sessions: expired past retention (deleted, revoked or not), expired recently (kept),
    // active (kept), revoked but unexpired (kept: needed for reuse detection).
    const oldSessionExpiry = ago(AUTH_SESSION_RETENTION_DAYS, 1000);
    const oldSession = await session({
      createdAt: created(oldSessionExpiry),
      expiresAt: oldSessionExpiry,
    });
    const oldRevoked = await session({
      createdAt: created(oldSessionExpiry),
      expiresAt: oldSessionExpiry,
      revokedAt: created(oldSessionExpiry),
    });
    const recentSessionExpiry = ago(1);
    const recentSession = await session({
      createdAt: created(recentSessionExpiry),
      expiresAt: recentSessionExpiry,
    });
    const activeSession = await session();
    const revokedActive = await session({ revokedAt: now });
    const users = await prisma.user.count();

    const result = await deleteExpiredAuthData(prisma, now);

    expect(result).toEqual({ deletedAuthSessions: 2, deletedGuestAccounts: 0 });
    const remainingSessions = (await prisma.authSession.findMany()).map((row) => row.id).sort();
    expect(remainingSessions).toEqual(
      [recentSession.id, activeSession.id, revokedActive.id].sort(),
    );
    expect(remainingSessions).not.toContain(oldSession.id);
    expect(remainingSessions).not.toContain(oldRevoked.id);
    expect(await prisma.user.count()).toBe(users);

    // Idempotent.
    expect(await deleteExpiredAuthData(prisma, now)).toEqual({
      deletedAuthSessions: 0,
      deletedGuestAccounts: 0,
    });
  });

  it("deletes guest accounts nobody can sign in to any more, with their data", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - (ORPHANED_GUEST_MIN_AGE_DAYS + 1) * DAY);
    const sessionFor = (userId: string, overrides: Record<string, unknown> = {}) =>
      session({ userId, createdAt: old, ...overrides });

    // Only an expired session: nobody can sign in. Deleted, with its profile and goal.
    const expiredOnly = await createUser({ createdAt: old });
    await sessionFor(expiredOnly.id, { expiresAt: new Date(now.getTime() - 1000) });
    await prisma.financialProfile.create({ data: { userId: expiredOnly.id } });
    await prisma.financialGoal.create({
      data: { userId: expiredOnly.id, type: "SAVINGS", name: "Goal", targetAmount: "1000.00" },
    });
    // Only a revoked (logged out) session: deleted.
    const revokedOnly = await createUser({ createdAt: old });
    await sessionFor(revokedOnly.id, { revokedAt: now });
    // No session at all (for example the seed users, or an old account): deleted.
    const noSession = await createUser({ createdAt: old });
    // A usable session: kept.
    const active = await createUser({ createdAt: old });
    await sessionFor(active.id);
    // Too new to judge (being created right now): kept.
    const brandNew = await createUser();
    // An ADMIN account is never deleted by the cleanup.
    const admin = await createUser({ createdAt: old, role: "ADMIN" });

    const result = await deleteExpiredAuthData(prisma, now);

    expect(result.deletedGuestAccounts).toBe(3);
    const remaining = (await prisma.user.findMany()).map((user) => user.id).sort();
    expect(remaining).toEqual([active.id, brandNew.id, admin.id].sort());
    expect(remaining).not.toContain(expiredOnly.id);
    expect(remaining).not.toContain(revokedOnly.id);
    expect(remaining).not.toContain(noSession.id);
    expect(await prisma.financialProfile.count()).toBe(0);
    expect(await prisma.financialGoal.count()).toBe(0);
  });
});
