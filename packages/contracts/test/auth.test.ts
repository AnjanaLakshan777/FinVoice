import { describe, expect, it } from "vitest";

import {
  API_ERROR_CODES,
  AUTH_ERROR_MESSAGES,
  noQuerySchema,
  ownFinancialGoalParamsSchema,
  requestOtpRequestSchema,
  updateUserRequestSchema,
  USER_ROLES,
  verifyOtpRequestSchema,
} from "../src/index.js";

const CHALLENGE_ID = "5d3c2f0e-8f7a-4b1e-9c6d-2a1b0c9d8e7f";

describe("requestOtpRequestSchema", () => {
  it("accepts an E.164 phone number", () => {
    expect(requestOtpRequestSchema.parse({ phoneNumber: "+94771234567" })).toEqual({
      phoneNumber: "+94771234567",
    });
  });

  it.each(["0771234567", "+94 77 123 4567", " +94771234567", "+94771234567 "])(
    "rejects %j instead of normalising it",
    (phoneNumber) => {
      expect(requestOtpRequestSchema.safeParse({ phoneNumber }).success).toBe(false);
    },
  );

  it.each([{ role: "ADMIN" }, { userId: CHALLENGE_ID }, { code: "12345678" }])(
    "rejects the extra property %j",
    (extra) => {
      expect(
        requestOtpRequestSchema.safeParse({ phoneNumber: "+94771234567", ...extra }).success,
      ).toBe(false);
    },
  );
});

describe("verifyOtpRequestSchema", () => {
  it("accepts a challenge, a code and the optional registration fields", () => {
    expect(
      verifyOtpRequestSchema.parse({
        challengeId: CHALLENGE_ID,
        code: "00012345",
        displayName: "  Kamal ",
        preferredLanguage: "SI",
      }),
    ).toEqual({
      challengeId: CHALLENGE_ID,
      code: "00012345",
      displayName: "Kamal",
      preferredLanguage: "SI",
    });
  });

  it.each([
    "1234567",
    "123456789",
    "1234 5678",
    "12345678 ",
    "abcdefgh",
    "１２３４５６７８",
    12345678,
  ])("rejects the code %j", (code) => {
    expect(verifyOtpRequestSchema.safeParse({ challengeId: CHALLENGE_ID, code }).success).toBe(
      false,
    );
  });

  it.each([
    { role: "ADMIN" },
    { status: "ACTIVE" },
    { userId: CHALLENGE_ID },
    { sessionId: CHALLENGE_ID },
    { accessToken: "x" },
    { refreshToken: "x" },
    { phoneNumber: "+94771234567" },
  ])("never lets the client choose %j", (extra) => {
    expect(
      verifyOtpRequestSchema.safeParse({ challengeId: CHALLENGE_ID, code: "12345678", ...extra })
        .success,
    ).toBe(false);
  });

  it("requires a UUID challenge id", () => {
    expect(verifyOtpRequestSchema.safeParse({ challengeId: "x", code: "12345678" }).success).toBe(
      false,
    );
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
    expect(noQuerySchema.safeParse({ userId: CHALLENGE_ID }).success).toBe(false);
    expect(ownFinancialGoalParamsSchema.safeParse({ goalId: CHALLENGE_ID }).success).toBe(true);
    expect(
      ownFinancialGoalParamsSchema.safeParse({ goalId: CHALLENGE_ID, userId: CHALLENGE_ID })
        .success,
    ).toBe(false);
  });
});

describe("authentication error messages", () => {
  it("are fixed: clients (the web app) rely on them", () => {
    expect(AUTH_ERROR_MESSAGES).toEqual({
      invalidCode: "The verification code is invalid or has expired",
      authenticationFailed: "Authentication failed",
      invalidRefreshToken: "Invalid or expired refresh token",
      invalidAccessToken: "Missing or invalid access token",
      tooManyOtpRequests: "Too many verification code requests. Try again later.",
      otpDeliveryFailed: "The verification code could not be sent. Try again later.",
      otpDeliveryNotConfigured: "Verification code delivery is not configured",
      notConfigured: "Authentication is not configured",
    });
  });

  it("never say whether a phone number is registered", () => {
    for (const message of Object.values(AUTH_ERROR_MESSAGES)) {
      expect(message).not.toMatch(/regist|not found|exist|unknown (user|number)/iu);
    }
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
