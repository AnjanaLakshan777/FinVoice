import type { PrismaClient } from "../generated/prisma/client.js";

const DAY_MS = 86_400_000;

export type AnalyticsCleanupResult = {
  /** Events older than this instant were deleted. */
  cutoff: Date;
  deleted: number;
};

/**
 * Deletes analytics events that occurred more than `retentionDays` days before `now`.
 *
 * Touches the analytics_events table only (through its own model, never raw SQL), so it cannot
 * change users, profiles, goals, knowledge or literacy data. Idempotent: a second run deletes
 * nothing new. Reports a count only, never event contents.
 */
export async function deleteExpiredAnalyticsEvents(
  prisma: Pick<PrismaClient, "analyticsEvent">,
  retentionDays: number,
  now: Date = new Date(),
): Promise<AnalyticsCleanupResult> {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error("The analytics retention period must be a whole number of days, at least 1");
  }
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const { count } = await prisma.analyticsEvent.deleteMany({
    where: { occurredAt: { lt: cutoff } },
  });
  return { cutoff, deleted: count };
}
