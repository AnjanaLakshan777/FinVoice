import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  AUTH_SESSION_RETENTION_DAYS,
  deleteExpiredAuthData,
  OTP_CHALLENGE_RETENTION_DAYS,
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

function createUser(phoneNumber = "+94000000801") {
  return prisma.user.create({ data: { phoneNumber, preferredLanguage: "EN" } });
}

function challenge(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return prisma.otpChallenge.create({
    data: {
      id: randomUUID(),
      phoneNumber: "+94000000801",
      codeHash: HASH,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 300_000),
      maxAttempts: 5,
      ...overrides,
    },
  });
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

describe("otp_challenges constraints", () => {
  it("accepts a well-formed challenge", async () => {
    await expect(challenge()).resolves.toMatchObject({ attempts: 0 });
  });

  it.each([
    ["phone_number_e164_check", { phoneNumber: "0771234567" }],
    ["code_hash_format_check", { codeHash: "12345678".padEnd(64, "Z") }],
    ["code_hash_format_check", { codeHash: "A".repeat(64) }],
    ["max_attempts_range_check", { maxAttempts: 0 }],
    ["max_attempts_range_check", { maxAttempts: 21 }],
    ["attempts_range_check", { attempts: 6 }],
    ["attempts_range_check", { attempts: -1 }],
    ["expires_after_created_check", { expiresAt: new Date(Date.now() - 1000) }],
    ["single_outcome_check", { consumedAt: new Date(), supersededAt: new Date() }],
  ])("enforces %s (%j)", async (constraint, overrides) => {
    await expectCheckViolation(challenge(overrides), `otp_challenges_${constraint}`);
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
  it("deletes only expired challenges and sessions past their retention period", async () => {
    const now = new Date();
    const ago = (days: number, extraMs = 0) => new Date(now.getTime() - days * DAY - extraMs);
    const created = (expiresAt: Date) => new Date(expiresAt.getTime() - 60_000);

    // Challenges: expired long ago (deleted), recently expired (kept), active (kept).
    const oldExpiry = ago(OTP_CHALLENGE_RETENTION_DAYS, 1000);
    const oldChallenge = await challenge({ createdAt: created(oldExpiry), expiresAt: oldExpiry });
    const recentExpiry = ago(0, 60_000);
    const recentChallenge = await challenge({
      createdAt: created(recentExpiry),
      expiresAt: recentExpiry,
    });
    const activeChallenge = await challenge();

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

    expect(result).toEqual({ deletedOtpChallenges: 1, deletedAuthSessions: 2 });
    const remainingChallenges = (await prisma.otpChallenge.findMany()).map((row) => row.id).sort();
    expect(remainingChallenges).toEqual([recentChallenge.id, activeChallenge.id].sort());
    expect(remainingChallenges).not.toContain(oldChallenge.id);
    const remainingSessions = (await prisma.authSession.findMany()).map((row) => row.id).sort();
    expect(remainingSessions).toEqual(
      [recentSession.id, activeSession.id, revokedActive.id].sort(),
    );
    expect(remainingSessions).not.toContain(oldSession.id);
    expect(remainingSessions).not.toContain(oldRevoked.id);
    expect(await prisma.user.count()).toBe(users);

    // Idempotent.
    expect(await deleteExpiredAuthData(prisma, now)).toEqual({
      deletedOtpChallenges: 0,
      deletedAuthSessions: 0,
    });
  });
});
