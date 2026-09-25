/**
 * Development seed: a small, deterministic set of clearly fake demo data.
 *
 * Run with `pnpm db:seed`. Running it again restores the same records (fixed ids, upserts) and
 * never touches other data. It refuses to run when NODE_ENV is "production" or when DATABASE_URL
 * does not point at this machine, so it cannot be run against a shared or production database
 * by accident.
 *
 * Phone numbers use "+94" followed by 0, which is never assigned in Sri Lanka's numbering plan,
 * so they cannot belong to a real person.
 */
import { loadDatabaseConfig } from "@finvoice/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type Prisma } from "../src/generated/prisma/client.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const users = [
  {
    id: "00000000-0000-7000-8000-000000000001",
    phoneNumber: "+94000000001",
    displayName: "Demo User (Sinhala)",
    preferredLanguage: "SI",
  },
  {
    id: "00000000-0000-7000-8000-000000000002",
    phoneNumber: "+94000000002",
    displayName: "Demo User (Tamil)",
    preferredLanguage: "TA",
  },
  {
    id: "00000000-0000-7000-8000-000000000003",
    phoneNumber: "+94000000003",
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
  } finally {
    await prisma.$disconnect();
  }

  console.info(
    `Seeded ${String(users.length)} users, ${String(financialProfiles.length)} financial profiles and ` +
      `${String(financialGoals.length)} financial goals.`,
  );
}

await main();
