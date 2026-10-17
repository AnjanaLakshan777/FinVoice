/**
 * Development seed: a small, deterministic set of clearly fake demo data.
 *
 * Run with `pnpm db:seed`. Running it again restores the same records (fixed ids, upserts) and
 * never touches other data. It refuses to run when NODE_ENV is "production" or when DATABASE_URL
 * does not point at this machine, so it cannot be run against a shared or production database
 * by accident.
 *
 * The demo users are guest accounts without any sessions, so nobody can sign in to them; they
 * exist for database-level development only, and `pnpm auth:cleanup` deletes them after a day.
 */
import { loadDatabaseConfig } from "@finvoice/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type Prisma } from "../src/generated/prisma/client.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const users = [
  {
    id: "00000000-0000-7000-8000-000000000001",
    displayName: "Demo User (Sinhala)",
    preferredLanguage: "SI",
  },
  {
    id: "00000000-0000-7000-8000-000000000002",
    displayName: "Demo User (Tamil)",
    preferredLanguage: "TA",
  },
  {
    id: "00000000-0000-7000-8000-000000000003",
    displayName: "Demo User (English)",
    preferredLanguage: "EN",
  },
] as const satisfies readonly (Prisma.UserCreateInput & { id: string })[];

const financialProfiles = [
  {
    id: "00000000-0000-7000-8001-000000000001",
    userId: users[0].id,
    monthlyIncome: "150000.00",
    monthlyExpenses: "110000.00",
  },
  {
    // Income known, expenses not yet provided.
    id: "00000000-0000-7000-8001-000000000002",
    userId: users[1].id,
    monthlyIncome: "85000.00",
    monthlyExpenses: null,
  },
] as const satisfies readonly (Prisma.FinancialProfileUncheckedCreateInput & { id: string })[];

const financialGoals = [
  {
    id: "00000000-0000-7000-8002-000000000001",
    userId: users[0].id,
    type: "EMERGENCY_FUND",
    name: "Three months of expenses",
    targetAmount: "330000.00",
    currentAmount: "120000.00",
    targetDate: new Date("2027-06-30"),
    status: "ACTIVE",
  },
  {
    id: "00000000-0000-7000-8002-000000000002",
    userId: users[0].id,
    type: "SAVINGS",
    name: "School supplies",
    targetAmount: "25000.00",
    currentAmount: "25000.00",
    targetDate: new Date("2026-01-15"),
    status: "COMPLETED",
  },
  {
    id: "00000000-0000-7000-8002-000000000003",
    userId: users[1].id,
    type: "DEBT_REPAYMENT",
    name: "Pay off shop credit",
    targetAmount: "60000.00",
    currentAmount: "15000.00",
    targetDate: null,
    status: "ACTIVE",
  },
] as const satisfies readonly (Prisma.FinancialGoalUncheckedCreateInput & { id: string })[];

/**
 * Literacy profiles for the demo users: BEGINNER and unassessed (assessedAt null), because no
 * assessment has been done. Created only if missing; an existing profile is never changed.
 */
const literacyProfiles = users.map((user, index) => ({
  id: `00000000-0000-7000-8003-00000000000${String(index + 1)}`,
  userId: user.id,
  level: "BEGINNER",
  assessmentVersion: "1",
  assessedAt: null,
})) satisfies (Prisma.FinancialLiteracyProfileUncheckedCreateInput & { id: string })[];

/** One clearly synthetic in-progress topic, for trying the context locally. Created only if missing. */
const literacyProgress = [
  {
    id: "00000000-0000-7000-8004-000000000001",
    userId: users[0].id,
    topic: "SAVING",
    status: "IN_PROGRESS",
    startedAt: new Date("2026-01-10T09:00:00.000Z"),
    lastActivityAt: new Date("2026-01-10T09:00:00.000Z"),
  },
] as const satisfies readonly (Prisma.FinancialLiteracyTopicProgressUncheckedCreateInput & {
  id: string;
})[];

async function main(): Promise<void> {
  const config = loadDatabaseConfig();
  if (config.nodeEnv === "production") {
    throw new Error(
      "Refusing to seed: NODE_ENV is production. The seed is for local development only.",
    );
  }
  // Only the host is reported, never the URL: it contains credentials.
  const { hostname } = new URL(config.url);
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`Refusing to seed: database host "${hostname}" is not local.`);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.url }) });
  try {
    await prisma.$transaction([
      ...users.map(({ id, ...data }) =>
        prisma.user.upsert({ where: { id }, create: { id, ...data }, update: data }),
      ),
      ...financialProfiles.map(({ id, ...data }) =>
        prisma.financialProfile.upsert({ where: { id }, create: { id, ...data }, update: data }),
      ),
      ...financialGoals.map(({ id, ...data }) =>
        prisma.financialGoal.upsert({ where: { id }, create: { id, ...data }, update: data }),
      ),
    ]);
    // Literacy data is only ever created, never overwritten: a demo user's level or progress may
    // have been changed through the internal API since the last seed.
    await prisma.financialLiteracyProfile.createMany({
      data: literacyProfiles,
      skipDuplicates: true,
    });
    await prisma.financialLiteracyTopicProgress.createMany({
      data: [...literacyProgress],
      skipDuplicates: true,
    });
  } finally {
    await prisma.$disconnect();
  }

  console.info(
    `Seeded ${String(users.length)} users, ${String(financialProfiles.length)} financial profiles, ` +
      `${String(financialGoals.length)} financial goals, and missing demo literacy profiles and progress.`,
  );
}

await main();
