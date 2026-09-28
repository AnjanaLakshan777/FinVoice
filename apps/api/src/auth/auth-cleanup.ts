import type { PrismaClient } from "../generated/prisma/client.js";

const DAY_MS = 86_400_000;

/**
 * OTP challenges are deleted one day after they expire. They are useless once expired; the day's
 * grace keeps recent ones around for the rate-limit window (at most 24 hours) and for debugging
 * counts.
 */
export const OTP_CHALLENGE_RETENTION_DAYS = 1;

/**
 * Auth sessions are deleted seven days after they expire. Revoked sessions are deliberately kept
 * until then (not deleted at revocation): a revoked row is what lets a reused refresh token be
 * recognised and its token family revoked. Once the session has expired its token is rejected
 * anyway.
 */
export const AUTH_SESSION_RETENTION_DAYS = 7;

export type AuthCleanupResult = {
  deletedOtpChallenges: number;
  deletedAuthSessions: number;
};

/**
 * Deletes expired OTP challenges and expired auth sessions past their retention period. Never
 * deletes an unexpired session (active or revoked) or an unexpired challenge, never touches users
 * or other data, and reports counts only.
 */
export async function deleteExpiredAuthData(
  prisma: Pick<PrismaClient, "otpChallenge" | "authSession">,
  now: Date = new Date(),
): Promise<AuthCleanupResult> {
  const challengeCutoff = new Date(now.getTime() - OTP_CHALLENGE_RETENTION_DAYS * DAY_MS);
  const sessionCutoff = new Date(now.getTime() - AUTH_SESSION_RETENTION_DAYS * DAY_MS);
  const challenges = await prisma.otpChallenge.deleteMany({
    where: { expiresAt: { lt: challengeCutoff } },
  });
  const sessions = await prisma.authSession.deleteMany({
    where: { expiresAt: { lt: sessionCutoff } },
  });
  return { deletedOtpChallenges: challenges.count, deletedAuthSessions: sessions.count };
}
