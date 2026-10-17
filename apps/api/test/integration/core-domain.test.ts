import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Prisma } from "../../src/generated/prisma/client.js";
import {
  createTestPrismaClient,
  expectCheckViolation,
  expectDatabaseError,
  truncateAllTables,
} from "./database.js";

const prisma = createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAllTables(prisma);
});

function createUser(overrides: Partial<Prisma.UserCreateInput> = {}) {
  return prisma.user.create({
    data: { preferredLanguage: "SI", ...overrides },
  });
}

function createGoal(
  userId: string,
  overrides: Partial<Prisma.FinancialGoalUncheckedCreateInput> = {},
) {
  return prisma.financialGoal.create({
    data: {
      userId,
      type: "EMERGENCY_FUND",
      name: "Emergency fund",
      targetAmount: "300000.00",
      ...overrides,
    },
  });
}

describe("User", () => {
  it("can be created, with database-generated UUIDv7 id and defaults", async () => {
    const user = await createUser({ displayName: "Demo User", preferredLanguage: "TA" });

    // UUIDv7: version nibble 7, RFC 9562 variant.
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(user).toMatchObject({
      displayName: "Demo User",
      preferredLanguage: "TA",
      timezone: "Asia/Colombo",
      status: "ACTIVE",
    });
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
  });

  it("has no phone number or other contact identifier", async () => {
    const user = await createUser();

    expect(Object.keys(user)).not.toContain("phoneNumber");
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`;
    expect(columns.map((column) => column.column_name)).not.toContain("phone_number");
  });

  it("rejects a blank display name", async () => {
    await expectCheckViolation(
      createUser({ displayName: "   " }),
      "users_display_name_not_blank_check",
    );
  });
});

describe("FinancialProfile", () => {
  it("can be linked to a user, defaults to LKR and stores money exactly", async () => {
    const user = await createUser();

    await prisma.financialProfile.create({
      data: { userId: user.id, monthlyIncome: "150000.10", monthlyExpenses: "98765.43" },
    });

    const loaded = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { financialProfile: true },
    });
    expect(loaded.financialProfile?.currency).toBe("LKR");
    expect(loaded.financialProfile?.monthlyIncome?.toFixed(2)).toBe("150000.10");
    expect(loaded.financialProfile?.monthlyExpenses?.toFixed(2)).toBe("98765.43");
  });

  it("allows only one profile per user", async () => {
    const user = await createUser();
    await prisma.financialProfile.create({ data: { userId: user.id } });

    await expectDatabaseError(prisma.financialProfile.create({ data: { userId: user.id } }), {
      code: "P2002",
    });
  });

  it("rejects negative monthly amounts", async () => {
    const user = await createUser();

    await expectCheckViolation(
      prisma.financialProfile.create({ data: { userId: user.id, monthlyIncome: "-0.01" } }),
      "financial_profiles_monthly_income_non_negative_check",
    );
    await expectCheckViolation(
      prisma.financialProfile.create({ data: { userId: user.id, monthlyExpenses: "-1000" } }),
      "financial_profiles_monthly_expenses_non_negative_check",
    );
  });

  it("rejects NaN as a monetary amount", async () => {
    const user = await createUser();

    // Raw SQL, because NaN must be rejected no matter which client writes it.
    await expectDatabaseError(
      prisma.$executeRaw`
        INSERT INTO financial_profiles (user_id, monthly_income) VALUES (${user.id}::uuid, 'NaN')`,
      { code: "P2010", message: "financial_profiles_monthly_income_non_negative_check" },
    );
  });

  it("rejects an invalid currency code", async () => {
    const user = await createUser();

    await expectCheckViolation(
      prisma.financialProfile.create({ data: { userId: user.id, currency: "lkr" } }),
      "financial_profiles_currency_iso4217_check",
    );
  });

  it("rejects amounts beyond NUMERIC(14,2)", async () => {
    const user = await createUser();

    await expectDatabaseError(
      prisma.financialProfile.create({
        data: { userId: user.id, monthlyIncome: "1000000000000.00" },
      }),
      { code: "P2020" },
    );
  });
});

describe("FinancialGoal", () => {
  it("can be linked to a user, with defaults", async () => {
    const user = await createUser();

    const goal = await createGoal(user.id, { targetDate: new Date("2027-06-30") });

    expect(goal).toMatchObject({ userId: user.id, status: "ACTIVE", currency: "LKR" });
    expect(goal.currentAmount.toFixed(2)).toBe("0.00");
    expect(goal.targetAmount.toFixed(2)).toBe("300000.00");
    expect(goal.targetDate?.toISOString()).toBe("2027-06-30T00:00:00.000Z");

    const goals = await prisma.financialGoal.findMany({ where: { userId: user.id } });
    expect(goals).toHaveLength(1);
  });

  it("allows a user to have many goals, with an optional target date", async () => {
    const user = await createUser();

    await createGoal(user.id);
    await createGoal(user.id, { type: "SAVINGS", name: "New bicycle", targetAmount: "45000" });

    expect(await prisma.financialGoal.count({ where: { userId: user.id } })).toBe(2);
  });

  it("requires a positive target amount", async () => {
    const user = await createUser();

    await expectCheckViolation(
      createGoal(user.id, { targetAmount: "0" }),
      "financial_goals_target_amount_positive_check",
    );
    // A negative target also breaks "current_amount <= target_amount" (current is at least 0), and
    // PostgreSQL reports whichever violated check it evaluates first; either rejection is correct.
    await expectDatabaseError(createGoal(user.id, { targetAmount: "-500.00" }), {
      code: "P2039",
      message: "violates check constraint",
    });
  });

  it("rejects a negative current amount", async () => {
    const user = await createUser();

    await expectCheckViolation(
      createGoal(user.id, { currentAmount: "-0.01" }),
      "financial_goals_current_amount_non_negative_check",
    );
  });

  it("rejects a current amount above the target amount, on create and on update", async () => {
    const user = await createUser();

    await expectCheckViolation(
      createGoal(user.id, { targetAmount: "1000.00", currentAmount: "1000.01" }),
      "financial_goals_current_amount_within_target_check",
    );

    const goal = await createGoal(user.id, { targetAmount: "1000.00", currentAmount: "1000.00" });
    await expectCheckViolation(
      prisma.financialGoal.update({ where: { id: goal.id }, data: { targetAmount: "999.99" } }),
      "financial_goals_current_amount_within_target_check",
    );
  });

  it("rejects a blank name", async () => {
    const user = await createUser();

    await expectCheckViolation(
      createGoal(user.id, { name: " " }),
      "financial_goals_name_not_blank_check",
    );
  });
});

describe("foreign keys", () => {
  it("reject a profile or goal for a user that does not exist", async () => {
    const missingUserId = randomUUID();

    await expectDatabaseError(prisma.financialProfile.create({ data: { userId: missingUserId } }), {
      code: "P2003",
    });
    await expectDatabaseError(createGoal(missingUserId), { code: "P2003" });
  });

  it("delete a user's profile and goals together with the user", async () => {
    const user = await createUser();
    const other = await createUser();
    await prisma.financialProfile.create({ data: { userId: user.id } });
    await createGoal(user.id);
    await createGoal(other.id);

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.financialProfile.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.financialGoal.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.financialGoal.count({ where: { userId: other.id } })).toBe(1);
  });
});
