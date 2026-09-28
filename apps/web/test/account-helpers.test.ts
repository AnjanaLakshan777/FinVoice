import {
  AUTH_ERROR_MESSAGES,
  FINANCIAL_GOAL_STATUSES,
  FINANCIAL_GOAL_TYPES,
  LANGUAGES,
  OTP_CODE_LENGTH as CONTRACT_OTP_CODE_LENGTH,
} from "@finvoice/contracts";
import { describe, expect, it } from "vitest";

import {
  AUTH_API_MESSAGES,
  GOAL_STATUS_OPTIONS,
  GOAL_TYPE_OPTIONS,
  LANGUAGE_OPTIONS,
  OTP_CODE_LENGTH,
} from "../lib/account/constants";
import { fieldErrors, friendlyError, MESSAGES } from "../lib/account/messages";
import { formatMoney, groupDigits, normalizeAmountInput, toCents } from "../lib/account/money";
import { ApiError, SessionExpiredError } from "../lib/auth/auth-client";

describe("constants mirrored from @finvoice/contracts", () => {
  it("match the API contract exactly", () => {
    expect(LANGUAGE_OPTIONS.map((option) => option.value)).toEqual([...LANGUAGES]);
    expect(GOAL_TYPE_OPTIONS.map((option) => option.value)).toEqual([...FINANCIAL_GOAL_TYPES]);
    expect(GOAL_STATUS_OPTIONS.map((option) => option.value)).toEqual([...FINANCIAL_GOAL_STATUSES]);
    expect(AUTH_API_MESSAGES.invalidCode).toBe(AUTH_ERROR_MESSAGES.invalidCode);
    expect(AUTH_API_MESSAGES.authenticationFailed).toBe(AUTH_ERROR_MESSAGES.authenticationFailed);
    expect(OTP_CODE_LENGTH).toBe(CONTRACT_OTP_CODE_LENGTH);
  });
});

describe("money strings (no floating point)", () => {
  it.each([
    ["150,000", "150000"],
    [" 1 250.50 ", "1250.50"],
    ["75000", "75000"],
    ["abc", "abc"],
  ])("tidies %j to %j and leaves validation to the API", (input, expected) => {
    expect(normalizeAmountInput(input)).toBe(expected);
  });

  it("groups digits for display without changing the value", () => {
    expect(groupDigits("150000.00")).toBe("150,000.00");
    expect(groupDigits("999999999999.99")).toBe("999,999,999,999.99");
    expect(groupDigits("0.10")).toBe("0.10");
    expect(formatMoney("1234567.89", "LKR")).toBe("LKR 1,234,567.89");
  });

  it("converts to exact whole cents", () => {
    expect(toCents("0.10")).toBe(10);
    expect(toCents("300000.00")).toBe(30_000_000);
    expect(toCents("999999999999.99")).toBe(99_999_999_999_999);
    expect(toCents("1.5")).toBe(150);
    expect(toCents("-1.00")).toBeNull();
  });
});

describe("friendly error messages", () => {
  const error = (status: number, code: string, message = "x") =>
    new ApiError(status, code, message);

  it.each([
    [error(400, "VALIDATION_ERROR"), "requestOtp", MESSAGES.invalidPhone],
    [error(400, "VALIDATION_ERROR"), "verifyOtp", MESSAGES.invalidCodeFormat],
    [
      error(401, "UNAUTHORIZED", AUTH_ERROR_MESSAGES.invalidCode),
      "verifyOtp",
      MESSAGES.codeIncorrect,
    ],
    [
      error(401, "UNAUTHORIZED", AUTH_ERROR_MESSAGES.authenticationFailed),
      "verifyOtp",
      MESSAGES.accountInactive,
    ],
    [error(429, "TOO_MANY_REQUESTS"), "requestOtp", MESSAGES.tooManyRequests],
    [error(503, "SERVICE_UNAVAILABLE"), "requestOtp", MESSAGES.unavailable],
    [error(0, "NETWORK_ERROR"), "account", MESSAGES.unavailable],
    [error(500, "INTERNAL_ERROR"), "account", MESSAGES.unavailable],
    [error(400, "VALIDATION_ERROR"), "account", MESSAGES.validation],
    [error(401, "UNAUTHORIZED"), "account", MESSAGES.sessionExpired],
    [new SessionExpiredError(), "account", MESSAGES.sessionExpired],
    [new Error("database exploded at 10.0.0.1"), "account", MESSAGES.unexpected],
  ] as const)("maps %o in %s", (caught, context, expected) => {
    expect(friendlyError(caught, context)).toBe(expected);
  });

  it("never passes a raw API message through", () => {
    const raw = new ApiError(500, "INTERNAL_ERROR", "Prisma P2002 on users_phone_number_key");

    expect(friendlyError(raw)).not.toContain("Prisma");
  });

  it("collects the API's field-level validation messages", () => {
    const caught = new ApiError(400, "VALIDATION_ERROR", "Request validation failed", [
      { field: "monthlyIncome", message: "Must be a decimal string" },
      { field: null, message: "Unrecognized key" },
      { field: "monthlyIncome", message: "Second message" },
    ]);

    expect(fieldErrors(caught)).toEqual({ monthlyIncome: "Must be a decimal string" });
    expect(fieldErrors(new ApiError(401, "UNAUTHORIZED", "x"))).toEqual({});
  });
});
