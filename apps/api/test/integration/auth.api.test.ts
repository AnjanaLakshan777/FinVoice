import { randomBytes, randomUUID } from "node:crypto";

import type {
  ApiErrorResponse,
  AuthMeResponse,
  AuthTokenResponse,
  RequestOtpResponse,
} from "@finvoice/contracts";
import type { LoggerService } from "@nestjs/common";
import { decodeJwt, SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SmsOtpDeliveryProvider, type OtpDelivery } from "../../src/auth/otp-delivery.js";
import { disabledAuthConfig, testAuthConfig, wrongOtpCode } from "../support/auth.js";
import { refreshCookieOf, startTestApi, type ApiResponse, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";

// Fake phone numbers: "+94" followed by 0 is never assigned in Sri Lanka's numbering plan.
const PHONE = "+94000000601";
const OTHER_PHONE = "+94000000602";
const INVALID_CODE = {
  statusCode: 401,
  code: "UNAUTHORIZED",
  message: "The verification code is invalid or has expired",
};
const AUTHENTICATION_FAILED = {
  statusCode: 401,
  code: "UNAUTHORIZED",
  message: "Authentication failed",
};
const INVALID_REFRESH = {
  statusCode: 401,
  code: "UNAUTHORIZED",
  message: "Invalid or expired refresh token",
};
const MISSING_TOKEN = {
  statusCode: 401,
  code: "UNAUTHORIZED",
  message: "Missing or invalid access token",
};
const TOO_MANY = {
  statusCode: 429,
  code: "TOO_MANY_REQUESTS",
  message: "Too many verification code requests. Try again later.",
};

/** Keeps everything the application logs, to prove that no credential ever reaches the logs. */
class CapturingLogger implements LoggerService {
  readonly lines: string[] = [];
  private add(values: unknown[]): void {
    this.lines.push(
      values
        .map((value) =>
          value instanceof Error
            ? `${value.name} ${value.message} ${value.stack ?? ""}`
            : JSON.stringify(value),
        )
        .join(" "),
    );
  }
  log(...values: unknown[]): void {
    this.add(values);
  }
  error(...values: unknown[]): void {
    this.add(values);
  }
  warn(...values: unknown[]): void {
    this.add(values);
  }
  debug(...values: unknown[]): void {
    this.add(values);
  }
  verbose(...values: unknown[]): void {
    this.add(values);
  }
  fatal(...values: unknown[]): void {
    this.add(values);
  }
}

const logger = new CapturingLogger();
let api: TestApi;
let code: string;
/** Every credential and phone number this file handles, checked against logs at the end. */
const sensitive = new Set<string>();

beforeAll(async () => {
  api = await startTestApi({ logger });
  code = api.auth.otp.devCode ?? "";
  sensitive.add(code).add(PHONE).add(OTHER_PHONE);
  for (const value of [api.auth.jwtSecret, api.auth.otpPepper]) {
    if (value !== null) {
      sensitive.add(value);
    }
  }
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await truncateAllTables(api.prisma);
});

function requestOtp(phoneNumber: string, extra: Record<string, unknown> = {}) {
  return api.request<RequestOtpResponse>("POST", "/api/v1/auth/request-otp", {
    phoneNumber,
    ...extra,
  });
}

async function challengeFor(phoneNumber = PHONE): Promise<string> {
  const response = await requestOtp(phoneNumber);
  expect(response.status).toBe(202);
  return response.body.challengeId;
}

async function verify(body: Record<string, unknown>) {
  const response = await api.request<AuthTokenResponse>("POST", "/api/v1/auth/verify-otp", body);
  if (response.status === 200) {
    sensitive.add(response.body.accessToken);
    sensitive.add(refreshCookieOf(response.headers, "finvoice_refresh").split("=")[1] ?? "");
  }
  return response;
}

async function refresh(cookie?: string) {
  const response = await api.request<AuthTokenResponse>(
    "POST",
    "/api/v1/auth/refresh",
    undefined,
    cookie === undefined ? {} : { cookie },
  );
  if (response.status === 200) {
    sensitive.add(response.body.accessToken);
  }
  return response;
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function cookieOf(response: ApiResponse): string {
  const cookie = refreshCookieOf(response.headers, "finvoice_refresh");
  sensitive.add(cookie.split("=")[1] ?? "");
  return cookie;
}

describe("POST /api/v1/auth/request-otp", () => {
  it("creates a challenge and answers generically, without the code", async () => {
    const response = await requestOtp(PHONE);

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      challengeId: expect.stringMatching(/^[0-9a-f-]{36}$/u) as unknown,
      expiresIn: 300,
      message: "If this number can be authenticated, a verification code has been requested.",
    });
    expect(response.text).not.toContain(code);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("stores only an HMAC of the code: no plaintext code, IP address or user agent", async () => {
    const response = await requestOtp(PHONE);

    const stored = await api.prisma.otpChallenge.findUniqueOrThrow({
      where: { id: response.body.challengeId },
    });
    expect(Object.keys(stored).sort()).toEqual(
      [
        "attempts",
        "codeHash",
        "consumedAt",
        "createdAt",
        "expiresAt",
        "id",
        "maxAttempts",
        "phoneNumber",
        "supersededAt",
      ].sort(),
    );
    expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(stored)).not.toContain(code);
    expect(stored).toMatchObject({ phoneNumber: PHONE, attempts: 0, maxAttempts: 5 });
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(300_000);
  });

  it("does not look up or create an account", async () => {
    await requestOtp(PHONE);

    expect(await api.prisma.user.count()).toBe(0);
  });

  it("answers identically for unknown, registered and inactive numbers (no enumeration)", async () => {
    await api.prisma.user.create({ data: { phoneNumber: OTHER_PHONE, preferredLanguage: "SI" } });
    await api.prisma.user.create({
      data: { phoneNumber: "+94000000603", preferredLanguage: "TA", status: "INACTIVE" },
    });

    const responses = await Promise.all(
      [PHONE, OTHER_PHONE, "+94000000603"].map((phone) => requestOtp(phone)),
    );

    const shapes = responses.map((response) => ({
      status: response.status,
      keys: Object.keys(response.body as object).sort(),
      message: response.body.message,
      expiresIn: response.body.expiresIn,
    }));
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });

  it.each([
    "0771234567",
    "94771234567",
    "+94 77 123 4567",
    "+94-77-1234567",
    "+1234567",
    "+1234567890123456",
    " +94771234567",
    94771234567,
  ])("rejects the malformed phone number %j (not normalised)", async (phoneNumber) => {
    const response = await api.request("POST", "/api/v1/auth/request-otp", { phoneNumber });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await api.prisma.otpChallenge.count()).toBe(0);
  });

  it.each([{ role: "ADMIN" }, { userId: randomUUID() }, { code: "12345678" }, { channel: "sms" }])(
    "rejects the extra property %j",
    async (extra) => {
      const response = await requestOtp(PHONE, extra);

      expect(response.status).toBe(400);
      expect(await api.prisma.otpChallenge.count()).toBe(0);
    },
  );
});

describe("OTP rate limiting (per phone number, database-backed)", () => {
  it("allows 3 requests per 15 minutes, then answers 429 without creating a challenge", async () => {
    for (let index = 0; index < 3; index += 1) {
      expect((await requestOtp(PHONE)).status).toBe(202);
    }

    const limited = await requestOtp(PHONE);

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual(TOO_MANY);
    expect(await api.prisma.otpChallenge.count()).toBe(3);
  });

  it("limits registered and unknown numbers the same way", async () => {
    await api.prisma.user.create({ data: { phoneNumber: OTHER_PHONE, preferredLanguage: "SI" } });
    for (let index = 0; index < 3; index += 1) {
      await requestOtp(PHONE);
      await requestOtp(OTHER_PHONE);
    }

    const unknown = await requestOtp(PHONE);
    const registered = await requestOtp(OTHER_PHONE);

    expect(unknown.body).toEqual(TOO_MANY);
    expect(registered.body).toEqual(TOO_MANY);
  });

  it("counts each phone number separately", async () => {
    for (let index = 0; index < 3; index += 1) {
      await requestOtp(PHONE);
    }

    expect((await requestOtp(OTHER_PHONE)).status).toBe(202);
  });

  it("holds under concurrent requests for the same number", async () => {
    const responses = await Promise.all(Array.from({ length: 10 }, () => requestOtp(PHONE)));

    expect(responses.filter((response) => response.status === 202)).toHaveLength(3);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(7);
    expect(await api.prisma.otpChallenge.count()).toBe(3);
    // Only the newest challenge is still active.
    expect(
      await api.prisma.otpChallenge.count({ where: { supersededAt: null, consumedAt: null } }),
    ).toBe(1);
  });

  it("allows new requests once the window has passed", async () => {
    for (let index = 0; index < 3; index += 1) {
      await requestOtp(PHONE);
    }
    const past = new Date(Date.now() - 901_000);
    await api.prisma.otpChallenge.updateMany({
      data: { createdAt: past, expiresAt: new Date(past.getTime() + 300_000) },
    });

    expect((await requestOtp(PHONE)).status).toBe(202);
  });
});

describe("POST /api/v1/auth/verify-otp", () => {
  it("registers an unknown number: USER, ACTIVE, with the registration fields", async () => {
    const challengeId = await challengeFor();

    const response = await verify({
      challengeId,
      code,
      displayName: "  Kamal  ",
      preferredLanguage: "SI",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      accessToken: expect.any(String) as unknown,
      tokenType: "Bearer",
      expiresIn: 900,
      user: {
        id: expect.any(String) as unknown,
        preferredLanguage: "SI",
        timezone: "Asia/Colombo",
        role: "USER",
      },
    });
    const user = await api.prisma.user.findUniqueOrThrow({ where: { phoneNumber: PHONE } });
    expect(user).toMatchObject({
      id: response.body.user.id,
      displayName: "Kamal",
      preferredLanguage: "SI",
      role: "USER",
      status: "ACTIVE",
    });
    expect(await api.prisma.authSession.count({ where: { userId: user.id } })).toBe(1);
  });

  it("defaults the language of a new account to EN", async () => {
    const response = await verify({ challengeId: await challengeFor(), code });

    expect(response.body.user.preferredLanguage).toBe("EN");
  });

  it("signs an existing user in without a duplicate, ignoring registration fields", async () => {
    const first = await verify({
      challengeId: await challengeFor(),
      code,
      displayName: "Kamal",
      preferredLanguage: "SI",
    });

    const second = await verify({
      challengeId: await challengeFor(),
      code,
      displayName: "Someone else",
      preferredLanguage: "TA",
    });

    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(await api.prisma.user.count()).toBe(1);
    expect(
      await api.prisma.user.findUniqueOrThrow({ where: { phoneNumber: PHONE } }),
    ).toMatchObject({ displayName: "Kamal", preferredLanguage: "SI" });
    // Two sign-ins, two independent sessions (two token families).
    const sessions = await api.prisma.authSession.findMany();
    expect(sessions).toHaveLength(2);
    expect(new Set(sessions.map((session) => session.tokenFamilyId)).size).toBe(2);
  });

  it("returns the refresh token only as an HttpOnly cookie, never in the body", async () => {
    const response = await verify({ challengeId: await challengeFor(), code });

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(
      /^finvoice_refresh=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/api\/v1\/auth; HttpOnly; SameSite=Lax$/u,
    );
    const token = cookieOf(response).split("=")[1] ?? "";
    expect(response.text).not.toContain(token);
    expect(response.text).not.toMatch(/refresh/iu);
    expect(response.headers.get("cache-control")).toBe("no-store");
    // Stored as a hash only.
    const [session] = await api.prisma.authSession.findMany();
    expect(session?.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(session)).not.toContain(token);
  });

  it("issues an access token for the session with only the intended claims", async () => {
    const response = await verify({ challengeId: await challengeFor(), code });

    const me = await api.request(
      "GET",
      "/api/v1/auth/me",
      undefined,
      bearer(response.body.accessToken),
    );
    expect(me.status).toBe(200);
    const claims = decodeJwt(response.body.accessToken);
    const [session] = await api.prisma.authSession.findMany();
    expect(claims).toMatchObject({
      sub: response.body.user.id,
      sid: session?.id,
      role: "USER",
      iss: "finvoice-api",
      aud: "finvoice",
    });
    expect(JSON.stringify(claims)).not.toContain(PHONE.slice(1));
  });

  it.each([
    { role: "ADMIN" },
    { status: "ACTIVE" },
    { userId: randomUUID() },
    { sessionId: randomUUID() },
    { accessToken: "x" },
    { refreshToken: "x" },
    { phoneNumber: OTHER_PHONE },
    { timezone: "UTC" },
  ])("rejects the client-chosen property %j without using up an attempt", async (extra) => {
    const challengeId = await challengeFor();

    const response = await verify({ challengeId, code, ...extra });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await api.prisma.user.count()).toBe(0);
    const stored = await api.prisma.otpChallenge.findUniqueOrThrow({ where: { id: challengeId } });
    expect(stored).toMatchObject({ attempts: 0, consumedAt: null });
  });

  it.each([
    "1234567",
    "123456789",
    "1234 5678",
    " 12345678",
    "abcdefgh",
    "１２３４５６７８",
    12345678,
  ])("rejects the malformed code %j", async (badCode) => {
    const response = await verify({ challengeId: await challengeFor(), code: badCode });

    expect(response.status).toBe(400);
    expect((response.body as unknown as ApiErrorResponse).details?.[0]?.field).toBe("code");
  });

  it("rejects a challenge id that is not a UUID", async () => {
    const response = await verify({ challengeId: "not-a-uuid", code });

    expect(response.status).toBe(400);
  });

  it("answers an unknown challenge exactly like a wrong code", async () => {
    const response = await verify({ challengeId: randomUUID(), code });

    expect(response.status).toBe(401);
    expect(response.body).toEqual(INVALID_CODE);
  });

  it("does not sign in an inactive user (generic 401, no session)", async () => {
    await api.prisma.user.create({
      data: { phoneNumber: PHONE, preferredLanguage: "SI", status: "INACTIVE" },
    });

    const response = await verify({ challengeId: await challengeFor(), code });

    expect(response.status).toBe(401);
    expect(response.body).toEqual(AUTHENTICATION_FAILED);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await api.prisma.authSession.count()).toBe(0);
  });

  it("answers wrong codes identically for registered, unknown and inactive numbers", async () => {
    await api.prisma.user.create({ data: { phoneNumber: OTHER_PHONE, preferredLanguage: "SI" } });
    await api.prisma.user.create({
      data: { phoneNumber: "+94000000603", preferredLanguage: "SI", status: "INACTIVE" },
    });

    const texts = [];
    for (const phone of [PHONE, OTHER_PHONE, "+94000000603"]) {
      const response = await verify({
        challengeId: await challengeFor(phone),
        code: wrongOtpCode(code),
      });
      expect(response.status).toBe(401);
      texts.push(response.text);
    }

    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).not.toMatch(/regist|exist|found|inactive/iu);
  });
});

describe("OTP brute-force protection", () => {
  it("allows 5 wrong attempts, then rejects even the correct code", async () => {
    const challengeId = await challengeFor();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await verify({ challengeId, code: wrongOtpCode(code) });
      expect(response.status, `attempt ${String(attempt)}`).toBe(401);
      expect(response.body).toEqual(INVALID_CODE);
    }
    const sixth = await verify({ challengeId, code: wrongOtpCode(code) });
    const correctAfterwards = await verify({ challengeId, code });

    expect(sixth.body).toEqual(INVALID_CODE);
    expect(correctAfterwards.status).toBe(401);
    expect(correctAfterwards.body).toEqual(INVALID_CODE);
    const stored = await api.prisma.otpChallenge.findUniqueOrThrow({ where: { id: challengeId } });
    // Exhausted: the counter stops at the limit instead of being reset or growing.
    expect(stored).toMatchObject({ attempts: 5, consumedAt: null });
    expect(await api.prisma.user.count()).toBe(0);
  });

  it("accepts the correct code within the limit", async () => {
    const challengeId = await challengeFor();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await verify({ challengeId, code: wrongOtpCode(code) });
    }

    expect((await verify({ challengeId, code })).status).toBe(200);
  });

  it("never compares more than 5 guesses, even when they arrive concurrently", async () => {
    const challengeId = await challengeFor();

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => verify({ challengeId, code: wrongOtpCode(code) })),
    );

    expect(responses.every((response) => response.status === 401)).toBe(true);
    const stored = await api.prisma.otpChallenge.findUniqueOrThrow({ where: { id: challengeId } });
    expect(stored.attempts).toBe(5);
    expect((await verify({ challengeId, code })).status).toBe(401);
  });

  it("rejects an expired code", async () => {
    const challengeId = await challengeFor();
    const now = Date.now();
    await api.prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { createdAt: new Date(now - 400_000), expiresAt: new Date(now - 100_000) },
    });

    const response = await verify({ challengeId, code });

    expect(response.status).toBe(401);
    expect(response.body).toEqual(INVALID_CODE);
  });

  it("rejects a code that was already used", async () => {
    const challengeId = await challengeFor();
    expect((await verify({ challengeId, code })).status).toBe(200);

    const again = await verify({ challengeId, code });

    expect(again.status).toBe(401);
    expect(again.body).toEqual(INVALID_CODE);
    expect(await api.prisma.authSession.count()).toBe(1);
  });

  it("invalidates the previous code when a new one is requested", async () => {
    const oldChallenge = await challengeFor();
    const newChallenge = await challengeFor();

    // The development code is the same for both: only supersession makes the old one fail.
    const old = await verify({ challengeId: oldChallenge, code });
    const current = await verify({ challengeId: newChallenge, code });

    expect(old.status).toBe(401);
    expect(old.body).toEqual(INVALID_CODE);
    expect(current.status).toBe(200);
    const stored = await api.prisma.otpChallenge.findUniqueOrThrow({ where: { id: oldChallenge } });
    expect(stored.supersededAt).not.toBeNull();
  });

  it("lets exactly one of many concurrent correct verifications succeed", async () => {
    const challengeId = await challengeFor();

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => verify({ challengeId, code })),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 401)).toHaveLength(9);
    expect(await api.prisma.user.count()).toBe(1);
    expect(await api.prisma.authSession.count()).toBe(1);
  });

  it("ends with one account when a first sign-in races an account creation for the number", async () => {
    // Only one challenge per number can be active, so the race is against an ADMIN provisioning
    // the same number: whichever insert loses falls back to the existing row (or answers 409).
    const challengeId = await challengeFor();
    const admin = await api.authHeaders(randomUUID(), "ADMIN");

    const [signIn] = await Promise.all([
      verify({ challengeId, code }),
      api.request("POST", "/api/v1/users", { phoneNumber: PHONE, preferredLanguage: "TA" }, admin),
    ]);

    expect(signIn.status).toBe(200);
    expect(await api.prisma.user.count()).toBe(1);
  });
});

describe("POST /api/v1/auth/refresh", () => {
  async function signIn(phone = PHONE) {
    const response = await verify({ challengeId: await challengeFor(phone), code });
    expect(response.status).toBe(200);
    return { body: response.body, cookie: cookieOf(response) };
  }

  it("rotates: a new access token and refresh cookie; the old refresh token is revoked", async () => {
    const { body, cookie } = await signIn();

    const response = await refresh(cookie);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ tokenType: "Bearer", expiresIn: 900, user: body.user });
    expect(response.body.accessToken).not.toBe(body.accessToken);
    const next = cookieOf(response);
    expect(next).not.toBe(cookie);
    expect(response.text).not.toContain(next.split("=")[1]);

    const sessions = await api.prisma.authSession.findMany({ orderBy: { createdAt: "asc" } });
    expect(sessions).toHaveLength(2);
    const [old, current] = sessions;
    expect(old).toMatchObject({
      replacedBySessionId: current?.id,
      tokenFamilyId: current?.tokenFamilyId,
    });
    expect(old?.revokedAt).not.toBeNull();
    expect(old?.lastUsedAt).not.toBeNull();
    expect(current?.revokedAt).toBeNull();
    expect(decodeJwt(response.body.accessToken).sid).toBe(current?.id);
  });

  it("keeps working along the rotation chain", async () => {
    let { cookie } = await signIn();
    for (let step = 0; step < 3; step += 1) {
      const response = await refresh(cookie);
      expect(response.status).toBe(200);
      cookie = cookieOf(response);
    }
    const me = await refresh(cookie);
    expect(me.status).toBe(200);
  });

  it("treats reuse of a rotated token as theft: revokes the whole family", async () => {
    const { cookie } = await signIn();
    const rotated = await refresh(cookie);
    const current = cookieOf(rotated);

    const reuse = await refresh(cookie);

    expect(reuse.status).toBe(401);
    expect(reuse.body).toEqual(INVALID_REFRESH);
    expect(await api.prisma.authSession.count({ where: { revokedAt: null } })).toBe(0);
    // The legitimate latest token of that family no longer works either.
    expect((await refresh(current)).status).toBe(401);
  });

  it("does not revoke other sign-ins of the same user on reuse", async () => {
    const first = await signIn();
    const second = await signIn();
    await refresh(first.cookie);

    await refresh(first.cookie);

    expect((await refresh(second.cookie)).status).toBe(200);
  });

  it("lets separate sessions of one user coexist and rotate independently", async () => {
    const phone = await signIn();
    const laptop = await signIn();

    const a = await refresh(phone.cookie);
    const b = await refresh(laptop.cookie);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.user.id).toBe(b.body.user.id);
  });

  it("rejects an expired refresh token", async () => {
    const { cookie } = await signIn();
    const now = Date.now();
    await api.prisma.authSession.updateMany({
      data: { createdAt: new Date(now - 40 * 86_400_000), expiresAt: new Date(now - 1000) },
    });

    const response = await refresh(cookie);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(INVALID_REFRESH);
  });

  it("rejects a refresh token revoked by logout", async () => {
    const { body, cookie } = await signIn();
    await api.request("POST", "/api/v1/auth/logout", undefined, bearer(body.accessToken));

    const response = await refresh(cookie);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(INVALID_REFRESH);
  });

  it("stops refreshing once the user is deactivated, and revokes the family", async () => {
    const { body, cookie } = await signIn();
    await api.prisma.user.update({ where: { id: body.user.id }, data: { status: "INACTIVE" } });

    const response = await refresh(cookie);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(INVALID_REFRESH);
    expect(await api.prisma.authSession.count({ where: { revokedAt: null } })).toBe(0);
  });

  it("picks up a role change made on the server at the next refresh", async () => {
    const { body, cookie } = await signIn();
    await api.prisma.user.update({ where: { id: body.user.id }, data: { role: "ADMIN" } });

    const response = await refresh(cookie);

    expect(response.body.user.role).toBe("ADMIN");
    expect(decodeJwt(response.body.accessToken).role).toBe("ADMIN");
  });

  it.each([
    ["no cookie", undefined],
    ["an empty cookie", "finvoice_refresh="],
    ["a malformed token", "finvoice_refresh=not-a-token"],
    ["an unknown token", `finvoice_refresh=${randomBytes(32).toString("base64url")}`],
    ["a different cookie name", `other=${randomBytes(32).toString("base64url")}`],
  ])("rejects %s with 401 and clears the cookie", async (_case, cookie) => {
    const response = await refresh(cookie);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(INVALID_REFRESH);
    expect(response.headers.get("set-cookie")).toMatch(/^finvoice_refresh=; Max-Age=0; /u);
  });

  it("does not accept the refresh token as a Bearer access token, or in a JSON body", async () => {
    const { cookie } = await signIn();
    const token = cookie.split("=")[1] ?? "";

    const asBearer = await api.request("GET", "/api/v1/auth/me", undefined, bearer(token));
    const inBody = await api.request("POST", "/api/v1/auth/refresh", { refreshToken: token });

    expect(asBearer.status).toBe(401);
    expect(inBody.status).toBe(401);
  });

  it("lets at most one of several concurrent refreshes with the same token succeed", async () => {
    const { cookie } = await signIn();

    const responses = await Promise.all(Array.from({ length: 5 }, () => refresh(cookie)));

    expect(responses.filter((response) => response.status === 200).length).toBeLessThanOrEqual(1);
    // Simultaneous use of one token is treated as reuse: the family ends up revoked.
    expect(await api.prisma.authSession.count({ where: { revokedAt: null } })).toBe(0);
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("revokes the current sign-in and clears the cookie (204)", async () => {
    const signedIn = await verify({ challengeId: await challengeFor(), code });
    const other = await verify({ challengeId: await challengeFor(), code });

    const response = await api.request(
      "POST",
      "/api/v1/auth/logout",
      undefined,
      bearer(signedIn.body.accessToken),
    );

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
    expect(response.headers.get("set-cookie")).toBe(
      "finvoice_refresh=; Max-Age=0; Path=/api/v1/auth; HttpOnly; SameSite=Lax",
    );
    const sid = decodeJwt(signedIn.body.accessToken).sid as string;
    expect(
      (await api.prisma.authSession.findUniqueOrThrow({ where: { id: sid } })).revokedAt,
    ).not.toBeNull();
    // The other device stays signed in.
    expect((await refresh(cookieOf(other))).status).toBe(200);
  });

  it("is idempotent", async () => {
    const signedIn = await verify({ challengeId: await challengeFor(), code });
    const headers = bearer(signedIn.body.accessToken);

    expect((await api.request("POST", "/api/v1/auth/logout", undefined, headers)).status).toBe(204);
    expect((await api.request("POST", "/api/v1/auth/logout", undefined, headers)).status).toBe(204);
  });

  it("requires an access token", async () => {
    const response = await api.request("POST", "/api/v1/auth/logout");

    expect(response.status).toBe(401);
    expect(response.body).toEqual(MISSING_TOKEN);
  });
});

describe("GET /api/v1/auth/me", () => {
  it("returns the minimal identity, without the phone number or financial data", async () => {
    const signedIn = await verify({
      challengeId: await challengeFor(),
      code,
      preferredLanguage: "TA",
    });

    const response = await api.request<AuthMeResponse>(
      "GET",
      "/api/v1/auth/me",
      undefined,
      bearer(signedIn.body.accessToken),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: signedIn.body.user.id,
      preferredLanguage: "TA",
      timezone: "Asia/Colombo",
      role: "USER",
      status: "ACTIVE",
    });
    expect(response.text).not.toContain(PHONE);
  });

  it("answers 401 for a user who was deactivated or deleted after signing in", async () => {
    const signedIn = await verify({ challengeId: await challengeFor(), code });
    const headers = bearer(signedIn.body.accessToken);

    await api.prisma.user.update({
      where: { id: signedIn.body.user.id },
      data: { status: "INACTIVE" },
    });
    const inactive = await api.request("GET", "/api/v1/auth/me", undefined, headers);
    await api.prisma.user.delete({ where: { id: signedIn.body.user.id } });
    const deleted = await api.request("GET", "/api/v1/auth/me", undefined, headers);

    expect(inactive.body).toEqual(AUTHENTICATION_FAILED);
    expect(deleted.body).toEqual(AUTHENTICATION_FAILED);
  });
});

describe("access-token checks over HTTP", () => {
  async function craftToken(changes: {
    secret?: Uint8Array;
    expiresIn?: string;
    alg?: string;
    subject?: string;
  }) {
    const secret = changes.secret ?? new TextEncoder().encode(api.auth.jwtSecret ?? "");
    return new SignJWT({ role: "USER", sid: randomUUID() })
      .setProtectedHeader({ alg: changes.alg ?? "HS256" })
      .setSubject(changes.subject ?? randomUUID())
      .setIssuer("finvoice-api")
      .setAudience("finvoice")
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(changes.expiresIn ?? "15m")
      .sign(secret);
  }

  it("accepts a valid token, with the scheme in any case", async () => {
    const user = await api.prisma.user.create({
      data: { phoneNumber: PHONE, preferredLanguage: "EN" },
    });
    const token = await craftToken({ subject: user.id });

    for (const scheme of ["Bearer", "bearer", "BEARER"]) {
      const response = await api.request("GET", "/api/v1/me/goals", undefined, {
        authorization: `${scheme} ${token}`,
      });
      expect(response.status, scheme).toBe(200);
    }
  });

  it.each([
    ["no Authorization header", () => Promise.resolve(undefined)],
    ["a Basic header", () => Promise.resolve(`Basic ${Buffer.from("u:p").toString("base64")}`)],
    ["a token without the scheme", () => craftToken({})],
    ["the scheme without a token", () => Promise.resolve("Bearer")],
    ["two spaces", async () => `Bearer  ${await craftToken({})}`],
    ["a malformed token", () => Promise.resolve("Bearer not.a.jwt")],
    ["an expired token", async () => `Bearer ${await craftToken({ expiresIn: "-1s" })}`],
    ["another secret", async () => `Bearer ${await craftToken({ secret: randomBytes(32) })}`],
    ["another algorithm", async () => `Bearer ${await craftToken({ alg: "HS384" })}`],
    [
      "a token with its signature removed",
      async () =>
        `Bearer ${await craftToken({}).then((t) => `${t.split(".").slice(0, 2).join(".")}.`)}`,
    ],
  ])("rejects %s with the same 401", async (_case, header) => {
    const value = await header();

    const response = await api.request(
      "GET",
      "/api/v1/me",
      undefined,
      value === undefined ? {} : { authorization: value },
    );

    expect(response.status).toBe(401);
    expect(response.body).toEqual(MISSING_TOKEN);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("does not accept the internal service token as a user credential", async () => {
    const internal = await startTestApi({
      internalToken: "internal-token-for-auth-tests-0123456789",
    });
    try {
      const response = await internal.request("GET", "/api/v1/me", undefined, {
        "x-finvoice-internal-token": "internal-token-for-auth-tests-0123456789",
        authorization: "Bearer internal-token-for-auth-tests-0123456789",
      });
      expect(response.status).toBe(401);
    } finally {
      await internal.close();
    }
  });
});

describe("roles", () => {
  it("an ADMIN (assigned in the database) can use admin operations after signing in", async () => {
    await api.prisma.user.create({
      data: { phoneNumber: PHONE, preferredLanguage: "EN", role: "ADMIN" },
    });
    const signedIn = await verify({ challengeId: await challengeFor(), code });
    expect(signedIn.body.user.role).toBe("ADMIN");

    const response = await api.request(
      "POST",
      "/api/v1/users",
      { phoneNumber: OTHER_PHONE, preferredLanguage: "SI" },
      bearer(signedIn.body.accessToken),
    );

    expect(response.status).toBe(201);
  });

  it("a USER gets 403 from admin operations", async () => {
    const signedIn = await verify({ challengeId: await challengeFor(), code });

    const response = await api.request(
      "POST",
      "/api/v1/users",
      { phoneNumber: OTHER_PHONE, preferredLanguage: "SI" },
      bearer(signedIn.body.accessToken),
    );

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: "FORBIDDEN" });
  });

  it("signing up never makes anyone an ADMIN", async () => {
    const signedIn = await verify({ challengeId: await challengeFor(), code });

    expect(signedIn.body.user.role).toBe("USER");
    expect(await api.prisma.user.count({ where: { role: "ADMIN" } })).toBe(0);
  });
});

describe("OTP delivery providers", () => {
  class RecordingSms extends SmsOtpDeliveryProvider {
    readonly name = "recording-sms";
    readonly deliveries: OtpDelivery[] = [];
    deliver(delivery: OtpDelivery): Promise<void> {
      this.deliveries.push(delivery);
      return Promise.resolve();
    }
  }

  class FailingSms extends SmsOtpDeliveryProvider {
    readonly name = "failing-sms";
    deliver(delivery: OtpDelivery): Promise<void> {
      return Promise.reject(
        new Error(`vendor rejected ${delivery.phoneNumber} with code ${delivery.code}`),
      );
    }
  }

  it("works end to end with a random code from an SMS-style provider", async () => {
    const sms = new RecordingSms();
    const withSms = await startTestApi({ otpDelivery: sms });
    try {
      const first = await withSms.request<RequestOtpResponse>("POST", "/api/v1/auth/request-otp", {
        phoneNumber: PHONE,
      });
      const second = await withSms.request<RequestOtpResponse>("POST", "/api/v1/auth/request-otp", {
        phoneNumber: PHONE,
      });
      const [one, two] = sms.deliveries;

      expect(one?.code).toMatch(/^[0-9]{8}$/u);
      expect(two?.code).not.toBe(one?.code);
      expect(first.text).not.toContain(one?.code);
      const verified = await withSms.request("POST", "/api/v1/auth/verify-otp", {
        challengeId: second.body.challengeId,
        code: two?.code,
      });
      expect(verified.status).toBe(200);
    } finally {
      await withSms.close();
    }
  });

  it("answers 503 and discards the challenge when delivery fails, logging no details", async () => {
    const failingLogger = new CapturingLogger();
    const failing = await startTestApi({ otpDelivery: new FailingSms(), logger: failingLogger });
    try {
      const response = await failing.request("POST", "/api/v1/auth/request-otp", {
        phoneNumber: PHONE,
      });

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        statusCode: 503,
        code: "SERVICE_UNAVAILABLE",
        message: "The verification code could not be sent. Try again later.",
      });
      const [challenge] = await failing.prisma.otpChallenge.findMany();
      expect(challenge?.supersededAt).not.toBeNull();
      const log = failingLogger.lines.join("\n");
      expect(log).toContain("OTP delivery failed (Error)");
      expect(log).not.toContain(PHONE);
      expect(log).not.toContain("vendor rejected");
    } finally {
      await failing.close();
    }
  });
});

describe("authentication not configured", () => {
  it("answers 503 for sign-in and protected routes; public routes keep working", async () => {
    const disabled = await startTestApi({ auth: disabledAuthConfig() });
    try {
      const unavailable = {
        statusCode: 503,
        code: "SERVICE_UNAVAILABLE",
        message: "Authentication is not configured",
      };
      for (const [method, path] of [
        ["POST", "/api/v1/auth/request-otp"],
        ["POST", "/api/v1/auth/refresh"],
        ["GET", "/api/v1/me"],
        ["GET", "/api/v1/auth/me"],
        ["GET", `/api/v1/users/${randomUUID()}`],
      ] as const) {
        const response = await disabled.request(
          method,
          path,
          path.endsWith("request-otp") ? { phoneNumber: PHONE } : undefined,
        );
        expect(response.status, path).toBe(503);
        expect(response.body, path).toEqual(unavailable);
      }
      expect((await disabled.request("GET", "/api/v1/knowledge/categories")).status).toBe(200);
      expect((await disabled.request("GET", "/health")).status).toBe(200);
    } finally {
      await disabled.close();
    }
  });

  it("answers 503 to sign-in when no OTP delivery provider is configured", async () => {
    const auth = testAuthConfig();
    const noDelivery = await startTestApi({
      auth: { ...auth, otp: { ...auth.otp, provider: null, devCode: null } },
    });
    try {
      const response = await noDelivery.request("POST", "/api/v1/auth/request-otp", {
        phoneNumber: PHONE,
      });

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        message: "Verification code delivery is not configured",
      });
      expect(await noDelivery.prisma.otpChallenge.count()).toBe(0);
    } finally {
      await noDelivery.close();
    }
  });
});

describe("credential hygiene", () => {
  it("never writes codes, phone numbers, tokens or secrets to the logs", async () => {
    // A full cycle, including failures and reuse detection (which logs a warning).
    const challengeId = await challengeFor();
    await verify({ challengeId, code: wrongOtpCode(code) });
    const signedIn = await verify({ challengeId, code });
    const cookie = cookieOf(signedIn);
    await refresh(cookie);
    await refresh(cookie);

    expect(logger.lines.join("\n")).toContain("token family revoked");
    const log = logger.lines.join("\n");
    for (const value of sensitive) {
      if (value.length >= 8) {
        expect(log).not.toContain(value);
      }
    }
    expect(log).not.toMatch(/authorization|cookie|Bearer /iu);
  });

  it("records nothing about authentication in analytics", async () => {
    const signedIn = await verify({ challengeId: await challengeFor(), code });
    await refresh(cookieOf(signedIn));
    await verify({ challengeId: randomUUID(), code });

    expect(await api.prisma.analyticsEvent.count()).toBe(0);
  });
});
