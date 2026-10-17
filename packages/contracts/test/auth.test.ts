import { describe, expect, it } from "vitest";

import {
  API_ERROR_CODES,
  AUTH_ERROR_MESSAGES,
  noQuerySchema,
  ownFinancialGoalParamsSchema,
  startGuestSessionRequestSchema,
  updateUserRequestSchema,
  USER_ROLES,
} from "../src/index.js";

const SOME_ID = "5d3c2f0e-8f7a-4b1e-9c6d-2a1b0c9d8e7f";

describe("startGuestSessionRequestSchema", () => {
  it("accepts a preferred language and an optional display name", () => {
    expect(startGuestSessionRequestSchema.parse({ preferredLanguage: "SI" })).toEqual({
      preferredLanguage: "SI",
    });
    expect(
      startGuestSessionRequestSchema.parse({ preferredLanguage: "TA", displayName: "  Kamal " }),
    ).toEqual({ preferredLanguage: "TA", displayName: "Kamal" });
    expect(
      startGuestSessionRequestSchema.parse({ preferredLanguage: "EN", displayName: "   " })
        .displayName,
    ).toBeNull();
  });

  it.each([{}, { preferredLanguage: "FR" }, { preferredLanguage: "si" }])(
    "requires a supported language: %j",
    (body) => {
      expect(startGuestSessionRequestSchema.safeParse(body).success).toBe(false);
    },
  );

  it.each([
    { role: "ADMIN" },
    { status: "ACTIVE" },
    { userId: SOME_ID },
    { sessionId: SOME_ID },
    { accessToken: "x" },
    { refreshToken: "x" },
    { phoneNumber: "+94771234567" },
  ])("never lets the client choose %j", (extra) => {
    expect(
      startGuestSessionRequestSchema.safeParse({ preferredLanguage: "SI", ...extra }).success,
    ).toBe(false);
  });
});

describe("user self-service updates", () => {
  it("accept only the display name and language", () => {
    expect(updateUserRequestSchema.safeParse({ displayName: "Kamal" }).success).toBe(true);
    expect(updateUserRequestSchema.safeParse({ preferredLanguage: "TA" }).success).toBe(true);
  });

  it.each([{ phoneNumber: "+94771234567" }, { status: "INACTIVE" }, { role: "ADMIN" }])(
    "reject %j",
    (body) => {
      expect(updateUserRequestSchema.safeParse(body).success).toBe(false);
    },
  );
});

describe("/me parameters", () => {
  it("take no query parameters and no user id", () => {
    expect(noQuerySchema.safeParse({}).success).toBe(true);
    expect(noQuerySchema.safeParse({ userId: SOME_ID }).success).toBe(false);
    expect(ownFinancialGoalParamsSchema.safeParse({ goalId: SOME_ID }).success).toBe(true);
    expect(
      ownFinancialGoalParamsSchema.safeParse({ goalId: SOME_ID, userId: SOME_ID }).success,
    ).toBe(false);
  });
});

describe("authentication error messages", () => {
  it("are fixed: clients (the web app) rely on them", () => {
    expect(AUTH_ERROR_MESSAGES).toEqual({
      authenticationFailed: "Authentication failed",
      invalidRefreshToken: "Invalid or expired refresh token",
      invalidAccessToken: "Missing or invalid access token",
      tooManyGuestSessions: "FinVoice is busy. Try again in a minute.",
      notConfigured: "Authentication is not configured",
    });
  });
});

describe("roles and error codes", () => {
  it("define exactly USER and ADMIN", () => {
    expect(USER_ROLES).toEqual(["USER", "ADMIN"]);
  });

  it("include the authorisation error codes", () => {
    expect(API_ERROR_CODES).toEqual(
      expect.arrayContaining(["UNAUTHORIZED", "FORBIDDEN", "TOO_MANY_REQUESTS"]),
    );
  });
});
