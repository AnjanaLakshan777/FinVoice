import type {
  FinancialGoalResponse,
  FinancialProfileResponse,
  UserResponse,
} from "@finvoice/contracts";
import { describe, expect, it } from "vitest";

import {
  computeCompleteness,
  toFinancialContext,
} from "../../src/financial-context/financial-context.mapper.js";
import { UNASSESSED_LITERACY_PROFILE } from "../../src/financial-literacy/financial-literacy-profile.service.js";

const USER: UserResponse = {
  id: "0190f0a0-0000-7000-8000-000000000001",
  phoneNumber: "+94000000123",
  displayName: "Private Name",
  preferredLanguage: "SI",
  timezone: "Asia/Colombo",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const PROFILE: FinancialProfileResponse = {
  userId: USER.id,
  monthlyIncome: "150000.00",
  monthlyExpenses: "100000.00",
  currency: "LKR",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const GOAL: FinancialGoalResponse = {
  id: "0190f0a0-0000-7000-8000-00000000000a",
  userId: USER.id,
  type: "EMERGENCY_FUND",
  name: "Emergency Fund",
  targetAmount: "300000.00",
  currentAmount: "50000.00",
  currency: "LKR",
  targetDate: "2027-06-30",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

function context(overrides: Partial<Parameters<typeof toFinancialContext>[0]> = {}) {
  return toFinancialContext({
    user: USER,
    profile: PROFILE,
    activeGoals: [GOAL],
    moreActiveGoals: false,
    literacy: UNASSESSED_LITERACY_PROFILE,
    progress: [
      {
        topic: "SAVING",
        status: "IN_PROGRESS",
        startedAt: "2026-02-01T00:00:00.000Z",
        completedAt: null,
        lastActivityAt: "2026-02-03T00:00:00.000Z",
      },
    ],
    ...overrides,
  });
}

describe("computeCompleteness", () => {
  it.each([
    [{ monthlyIncome: "1.00", monthlyExpenses: "1.00" }, 1, []],
    [{ monthlyIncome: "0.00", monthlyExpenses: "0.00" }, 1, []],
    [{ monthlyIncome: null, monthlyExpenses: "0.00" }, 1, ["monthlyIncome"]],
    [{ monthlyIncome: "0.00", monthlyExpenses: null }, 2, ["monthlyExpenses"]],
    [{ monthlyIncome: "5.00", monthlyExpenses: "5.00" }, 0, ["activeGoal"]],
    [null, 0, ["monthlyIncome", "monthlyExpenses", "activeGoal"]],
  ] as const)("profile %j with %i active goals → missing %j", (profile, goals, missing) => {
    expect(computeCompleteness(profile, goals)).toEqual({
      profileComplete: missing.length === 0,
      missingFields: [...missing],
    });
  });
});

describe("toFinancialContext", () => {
  it("copies exactly the allowed fields", () => {
    expect(context()).toEqual({
      user: { preferredLanguage: "SI", timezone: "Asia/Colombo" },
      profile: { monthlyIncome: "150000.00", monthlyExpenses: "100000.00", currency: "LKR" },
      goals: [
        {
          type: "EMERGENCY_FUND",
          name: "Emergency Fund",
          targetAmount: "300000.00",
          currentAmount: "50000.00",
          targetDate: "2027-06-30",
          currency: "LKR",
          status: "ACTIVE",
        },
      ],
      moreActiveGoals: false,
      literacy: {
        level: "BEGINNER",
        assessmentVersion: "1",
        assessedAt: null,
        topics: [
          { topic: "SAVING", status: "IN_PROGRESS", lastActivityAt: "2026-02-03T00:00:00.000Z" },
        ],
      },
      completeness: { profileComplete: true, missingFields: [] },
    });
  });

  it("never includes ids, phone number, display name or record timestamps", () => {
    const text = JSON.stringify(context());
    for (const value of [
      USER.id,
      GOAL.id,
      USER.phoneNumber,
      "Private Name",
      "2026-01-02T00:00:00.000Z",
    ]) {
      expect(text).not.toContain(value);
    }
  });

  it("keeps money as the exact strings it was given (no arithmetic, no numbers)", () => {
    const result = context({
      profile: { ...PROFILE, monthlyIncome: "999999999999.99", monthlyExpenses: "0.10" },
    });
    expect(result.profile).toMatchObject({
      monthlyIncome: "999999999999.99",
      monthlyExpenses: "0.10",
    });
    expect(typeof result.goals[0]?.targetAmount).toBe("string");
  });

  it("represents a missing profile as null, not zeros", () => {
    const result = context({ profile: null, activeGoals: [] });
    expect(result.profile).toBeNull();
    expect(result.completeness.missingFields).toEqual([
      "monthlyIncome",
      "monthlyExpenses",
      "activeGoal",
    ]);
  });
});
