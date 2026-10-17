import type { PrismaClient } from "../generated/prisma/client.js";

const DAY_MS = 86_400_000;

/**
 * Auth sessions are deleted seven days after they expire. Revoked sessions are deliberately kept
 * until then (not deleted at revocation): a revoked row is what lets a reused refresh token be
 * recognised and its token family revoked. Once the session has expired its token is rejected
 * anyway.
 */
export const AUTH_SESSION_RETENTION_DAYS = 7;

/**
 * A guest account is deleted once it has had no usable session (unrevoked and unexpired) and is at
 * least this old. Without a usable session nobody can ever sign in to it again, so its data must
 * not be kept. The minimum age protects an account that is being created right now.
 */
export const ORPHANED_GUEST_MIN_AGE_DAYS = 1;

export type AuthCleanupResult = {
  deletedAuthSessions: number;
  deletedGuestAccounts: number;
};

/**
 * Deletes expired auth sessions past their retention period, and guest accounts that nobody can
 * sign in to any more (with their profiles, goals and literacy data, by ON DELETE CASCADE). Never
 * deletes an unexpired session or an ADMIN account, and reports counts only.
 */
export async function deleteExpiredAuthData(
  prisma: Pick<PrismaClient, "authSession" | "user">,
  now: Date = new Date(),
): Promise<AuthCleanupResult> {
  const sessionCutoff = new Date(now.getTime() - AUTH_SESSION_RETENTION_DAYS * DAY_MS);
  const guestCutoff = new Date(now.getTime() - ORPHANED_GUEST_MIN_AGE_DAYS * DAY_MS);
  const guests = await prisma.user.deleteMany({
    where: {
      role: "USER",
      createdAt: { lt: guestCutoff },
      authSessions: { none: { revokedAt: null, expiresAt: { gt: now } } },
    },
  });
  const sessions = await prisma.authSession.deleteMany({
    where: { expiresAt: { lt: sessionCutoff } },
  });
  return { deletedAuthSessions: sessions.count, deletedGuestAccounts: guests.count };
}
