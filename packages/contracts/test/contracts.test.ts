import { describe, expect, it } from "vitest";

import {
  calendarDateSchema,
  createFinancialGoalRequestSchema,
  createUserRequestSchema,
  currencyCodeSchema,
  listFinancialGoalsQuerySchema,
  moneyAmountSchema,
  phoneNumberSchema,
  positiveMoneyAmountSchema,
  updateUserRequestSchema,
} from "../src/index.js";

describe("moneyAmountSchema", () => {
  it.each(["0", "0.00", "100", "100.00", "100.5", "100.50", "999999999999.99"])(
    "accepts %j",
    (value) => {
      expect(moneyAmountSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each([
    "100.123",
    "1.999",
    "100.001",
    "-10.00",
    "abc",
    "NaN",
    "Infinity",
    "1e5",
    "",
    " 100",
    "100.",
    ".5",
    "007",
    "+10",
    "1,000.00",
    "1000000000000.00",
  ])("rejects %j", (value) => {
    expect(moneyAmountSchema.safeParse(value).success).toBe(false);
  });

  it("rejects JSON numbers, which are not exact", () => {
    expect(moneyAmountSchema.safeParse(150000.5).success).toBe(false);
  });
});

describe("positiveMoneyAmountSchema", () => {
  it.each(["0", "0.0", "0.00"])("rejects zero %j", (value) => {
    expect(positiveMoneyAmountSchema.safeParse(value).success).toBe(false);
  });

  it.each(["0.01", "1", "300000.00"])("accepts %j", (value) => {
    expect(positiveMoneyAmountSchema.safeParse(value).success).toBe(true);
  });
});

describe("currencyCodeSchema", () => {
  it("accepts an uppercase ISO 4217 code", () => {
    expect(currencyCodeSchema.safeParse("LKR").success).toBe(true);
  });

  it.each(["lkr", "LK", "LKRR", "L1R", ""])("rejects %j", (value) => {
    expect(currencyCodeSchema.safeParse(value).success).toBe(false);
  });
});

describe("calendarDateSchema", () => {
  it.each(["2027-06-30", "2028-02-29", "2026-12-31"])("accepts %j unchanged", (value) => {
    expect(calendarDateSchema.parse(value)).toBe(value);
  });

  it.each([
    "2027-02-29",
    "2027-02-30",
    "2027-13-01",
    "2027-00-10",
    "2027-6-30",
    "30-06-2027",
    "2027-06-30T00:00:00Z",
    "not-a-date",
  ])("rejects %j", (value) => {
    expect(calendarDateSchema.safeParse(value).success).toBe(false);
  });
});

describe("phoneNumberSchema", () => {
  it.each(["+94771234567", "+12025550123", "+123456789012345"])("accepts %j", (value) => {
    expect(phoneNumberSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    "0771234567",
    "94771234567",
    "+94 77 123 4567",
    "+0771234567",
    "+1234567890123456",
    "+1234567",
  ])("rejects %j", (value) => {
    expect(phoneNumberSchema.safeParse(value).success).toBe(false);
  });
});

describe("createUserRequestSchema", () => {
  it("trims the display name and turns a blank one into null", () => {
    const base = { phoneNumber: "+94771234567", preferredLanguage: "SI" };

    expect(createUserRequestSchema.parse({ ...base, displayName: "  Kamal  " }).displayName).toBe(
      "Kamal",
    );
    expect(createUserRequestSchema.parse({ ...base, displayName: "   " }).displayName).toBeNull();
  });

  it("rejects properties that are not part of the contract", () => {
    const result = createUserRequestSchema.safeParse({
      phoneNumber: "+94771234567",
      preferredLanguage: "SI",
      isAdmin: true,
      status: "ACTIVE",
    });

    expect(result.success).toBe(false);
  });
});

describe("updateUserRequestSchema", () => {
  it("rejects an empty update", () => {
    expect(updateUserRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("createFinancialGoalRequestSchema", () => {
  it("does not accept a status on creation", () => {
    const result = createFinancialGoalRequestSchema.safeParse({
      type: "SAVINGS",
      name: "Bicycle",
      targetAmount: "45000",
      status: "COMPLETED",
    });

    expect(result.success).toBe(false);
  });
});

describe("listFinancialGoalsQuerySchema", () => {
  it("defaults to page 1 with 20 items", () => {
    expect(listFinancialGoalsQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it("coerces query-string numbers", () => {
    expect(listFinancialGoalsQuerySchema.parse({ page: "2", limit: "50" })).toEqual({
      page: 2,
      limit: 50,
    });
  });

  it.each([
    { page: "0" },
    { page: "1.5" },
    { page: "abc" },
    { limit: "0" },
    { limit: "101" },
    { status: "DONE" },
    { sort: "name" },
  ])("rejects %j", (query) => {
    expect(listFinancialGoalsQuerySchema.safeParse(query).success).toBe(false);
  });
});
