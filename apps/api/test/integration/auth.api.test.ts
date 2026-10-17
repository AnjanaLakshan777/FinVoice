import { randomBytes, randomUUID } from "node:crypto";

import type { ApiErrorResponse, AuthMeResponse, AuthTokenResponse } from "@finvoice/contracts";
import type { LoggerService } from "@nestjs/common";
import { decodeJwt, SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { REFRESH_GRACE_MS, SessionService } from "../../src/auth/session.service.js";
import { disabledAuthConfig, testAuthConfig } from "../support/auth.js";
import { refreshCookieOf, startTestApi, type ApiResponse, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";

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
  message: "FinVoice is busy. Try again in a minute.",
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
/** Every credential this file handles, checked against logs at the end. */
const sensitive = new Set<string>();

beforeAll(async () => {
  api = await startTestApi({ logger });
  if (api.auth.jwtSecret !== null) {
    sensitive.add(api.auth.jwtSecret);
  }
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await truncateAllTables(api.prisma);
});

async function guest(body: Record<string, unknown> = { preferredLanguage: "EN" }) {
  const response = await api.request<AuthTokenResponse>("POST", "/api/v1/auth/guest", body);
  if (response.status === 201) {
    sensitive.add(response.body.accessToken);
    sensitive.add(refreshCookieOf(response.headers, "finvoice_refresh").split("=")[1] ?? "");
  }
  return response;
}

/** A new guest account, signed in. */
async function signIn(body?: Record<string, unknown>) {
  const response = await guest(body);
  expect(response.status).toBe(201);
  return { body: response.body, cookie: cookieOf(response) };
}

/**
 * A second, independent sign-in of the same account (another token family). Guests cannot do
 * this through the API, but the session model supports it, so the tests keep covering it.
 */
async function anotherSession(userId: string) {
  const session = await api.get(SessionService).start(userId);
  sensitive.add(session.refreshToken);
  return { cookie: `finvoice_refresh=${session.refreshToken}` };
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

/** Moves every rotation back past the grace period, as if REFRESH_GRACE_MS had elapsed. */
async function expireGrace(): Promise<void> {
  await api.prisma.authSession.updateMany({
    where: { revokedAt: { not: null } },
    data: { revokedAt: new Date(Date.now() - REFRESH_GRACE_MS - 1000) },
  });
}

async function activeSessions(): Promise<number> {
  return api.prisma.authSession.count({ where: { revokedAt: null } });
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function cookieOf(response: ApiResponse): string {
  const cookie = refreshCookieOf(response.headers, "finvoice_refresh");
  sensitive.add(cookie.split("=")[1] ?? "");
  return cookie;
}

describe("POST /api/v1/auth/guest", () => {
  it("creates a guest account (USER, ACTIVE) from the language and optional name", async () => {
    const response = await guest({ preferredLanguage: "SI", displayName: "  Kamal  " });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      tokenType: "Bearer",
      expiresIn: 900,
      user: { preferredLanguage: "SI", timezone: "Asia/Colombo", role: "USER" },
    });
    const user = await api.prisma.user.findUniqueOrThrow({ where: { id: response.body.user.id } });
    expect(user).toMatchObject({
      displayName: "Kamal",
      preferredLanguage: "SI",
      role: "USER",
      status: "ACTIVE",
    });
    expect(await activeSessions()).toBe(1);
  });

  it("creates a new, separate account every time (there is nothing to sign back in with)", async () => {
    const first = await signIn();
    const second = await signIn();

    expect(first.body.user.id).not.toBe(second.body.user.id);
    expect(await api.prisma.user.count()).toBe(2);
  });

  it("returns the refresh token only as an HttpOnly cookie, never in the body", async () => {
    const response = await guest();
    const cookie = response.headers.getSetCookie()[0] ?? "";
    const token = cookieOf(response).split("=")[1] ?? "";

    expect(cookie).toMatch(/^finvoice_refresh=[A-Za-z0-9_-]{43}; /u);
    expect(cookie).toContain("Path=/api/v1/auth");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(response.text).not.toContain(token);
    const stored = await api.prisma.authSession.findFirstOrThrow();
    expect(stored.refreshTokenHash).not.toBe(token);
  });

  it("issues an access token for the session with only the intended claims", async () => {
    const { body } = await signIn();
    const claims = decodeJwt(body.accessToken);
    const session = await api.prisma.authSession.findFirstOrThrow();

    expect(claims).toMatchObject({
      sub: body.user.id,
      role: "USER",
      sid: session.id,
      iss: "finvoice-api",
      aud: "finvoice",
    });
    expect(Object.keys(claims).sort()).toEqual(
      ["aud", "exp", "iat", "iss", "jti", "role", "sid", "sub"].sort(),
    );
  });

  it.each([
    ["no body", undefined],
    ["no language", {}],
    ["an unsupported language", { preferredLanguage: "FR" }],
    ["a lower-case language", { preferredLanguage: "si" }],
  ])("rejects %s with 400 and creates nothing", async (_case, body) => {
    const response = await api.request<ApiErrorResponse>("POST", "/api/v1/auth/guest", body);

    expect(response.status).toBe(400);
    expect(await api.prisma.user.count()).toBe(0);
  });

  it.each([
    { role: "ADMIN" },
    { status: "INACTIVE" },
    { userId: randomUUID() },
    { sessionId: randomUUID() },
    { phoneNumber: "+94771234567" },
    { refreshToken: "x" },
  ])("never lets the client choose %j", async (extra) => {
    const response = await guest({ preferredLanguage: "EN", ...extra });

    expect(response.status).toBe(400);
    expect(await api.prisma.user.count()).toBe(0);
  });

  it.each(["application/x-www-form-urlencoded", "text/plain", "multipart/form-data; boundary=x"])(
    "refuses a %s body (an HTML form on another site), so it cannot replace a session",
    async (contentType) => {
      const response = await api.requestRaw(
        "POST",
        "/api/v1/auth/guest",
        contentType.startsWith("multipart")
          ? `--x
Content-Disposition: form-data; name="preferredLanguage"

SI
--x--
`
          : "preferredLanguage=SI",
        { "content-type": contentType },
      );

      expect([400, 415]).toContain(response.status);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await api.prisma.user.count()).toBe(0);
    },
  );

  it("answers 415 for a form body that would otherwise be valid", async () => {
    const response = await api.requestRaw("POST", "/api/v1/auth/guest", "preferredLanguage=SI", {
      "content-type": "application/x-www-form-urlencoded",
    });

    expect(response.status).toBe(415);
    expect(response.body).toEqual({
      statusCode: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Unsupported content type",
    });
    expect(await api.prisma.user.count()).toBe(0);
  });
});

describe("guest rate limiting (all clients together, database-backed)", () => {
  let limited: TestApi;

  beforeAll(async () => {
    // The same capturing logger: Nest's logger is process-wide, so a second application without
    // it would silence the main application's logs for the log assertions below.
    limited = await startTestApi({
      logger,
      auth: testAuthConfig({ guest: { limit: 3, windowSeconds: 60 } }),
    });
  });

  afterAll(async () => {
    await limited.close();
  });

  const create = () =>
    limited.request<ApiErrorResponse>("POST", "/api/v1/auth/guest", { preferredLanguage: "EN" });

  it("allows the configured number per window, then answers 429 without creating an account", async () => {
    for (let index = 0; index < 3; index++) {
      expect((await create()).status).toBe(201);
    }
    const fourth = await create();

    expect(fourth.status).toBe(429);
    expect(fourth.body).toEqual(TOO_MANY);
    expect(await limited.prisma.user.count()).toBe(3);
  });

  it("holds under concurrent requests", async () => {
    const responses = await Promise.all(Array.from({ length: 10 }, create));

    expect(responses.filter((response) => response.status === 201)).toHaveLength(3);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(7);
    expect(await limited.prisma.user.count()).toBe(3);
  });

  it("allows new accounts once the window has passed", async () => {
    for (let index = 0; index < 3; index++) {
      await create();
    }
    await limited.prisma.user.updateMany({
      data: { createdAt: new Date(Date.now() - 61_000) },
    });

    expect((await create()).status).toBe(201);
  });
});

describe("POST /api/v1/auth/refresh", () => {
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

  it("treats reuse of a rotated token after the grace period as theft: revokes the whole family", async () => {
    const { cookie } = await signIn();
    const rotated = await refresh(cookie);
    const current = cookieOf(rotated);
    await expireGrace();

    const reuse = await refresh(cookie);

    expect(reuse.status).toBe(401);
    expect(reuse.body).toEqual(INVALID_REFRESH);
    expect(await api.prisma.authSession.count({ where: { revokedAt: null } })).toBe(0);
    // The legitimate latest token of that family no longer works either.
    expect((await refresh(current)).status).toBe(401);
  });

  it("does not revoke other sign-ins of the same user on reuse", async () => {
    const first = await signIn();
    const second = await anotherSession(first.body.user.id);
    await refresh(first.cookie);
    await expireGrace();

    expect((await refresh(first.cookie)).status).toBe(401);

    expect((await refresh(second.cookie)).status).toBe(200);
  });

  it("lets separate sessions of one user coexist and rotate independently", async () => {
    const phone = await signIn();
    const laptop = await anotherSession(phone.body.user.id);

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

  it("lets at most two of many concurrent refreshes with one token succeed, then revokes the family", async () => {
    const { cookie } = await signIn();

    const responses = await Promise.all(Array.from({ length: 5 }, () => refresh(cookie)));

    // One rotation and at most one grace reuse; every further use is replay: family revoked.
    expect(responses.filter((response) => response.status === 200)).toHaveLength(2);
    expect(responses.filter((response) => response.status === 401)).toHaveLength(3);
    expect(await activeSessions()).toBe(0);
    for (const response of responses.filter((candidate) => candidate.status === 200)) {
      expect((await refresh(cookieOf(response))).status).toBe(401);
    }
  });
});

describe("refresh grace period (overlapping refreshes of the previous token)", () => {
  it("normal refresh A → B: B is the family's only active session", async () => {
    const { cookie } = await signIn();

    const b = await refresh(cookie);

    expect(b.status).toBe(200);
    expect(await activeSessions()).toBe(1);
    expect((await refresh(cookieOf(b))).status).toBe(200);
  });

  it("two concurrent refreshes with A (a reload race) both succeed and keep the sign-in", async () => {
    const { cookie } = await signIn();

    const responses = await Promise.all([refresh(cookie), refresh(cookie)]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    // No family revocation: both new cookies are valid, whichever the browser keeps.
    expect(await activeSessions()).toBe(2);
    const [first, second] = responses.map((response) => cookieOf(response));
    expect(first).not.toBe(second);
    for (const response of responses) {
      // No refresh token (or other secret) in the body: only the access token and the identity.
      expect(Object.keys(response.body).sort()).toEqual(
        ["accessToken", "expiresIn", "tokenType", "user"].sort(),
      );
      expect(response.text).not.toContain(cookie.split("=")[1]);
      expect(response.text).not.toContain(cookieOf(response).split("=")[1]);
    }
  });

  it.each([0, 1])(
    "keeps whichever cookie the browser retains usable (retained: response %i)",
    async (retained) => {
      const { cookie } = await signIn();
      const responses = await Promise.all([refresh(cookie), refresh(cookie)]);
      const kept = cookieOf(responses[retained] as ApiResponse);

      const next = await refresh(kept);

      expect(next.status).toBe(200);
      // The unused half of the overlap is closed by that rotation: one active session again.
      expect(await activeSessions()).toBe(1);
      expect((await refresh(cookieOf(next))).status).toBe(200);
    },
  );

  it("accepts A once more if its first refresh's response was lost (sequential reload)", async () => {
    const { cookie } = await signIn();
    const b = await refresh(cookie);

    const again = await refresh(cookie);

    expect(again.status).toBe(200);
    expect(await activeSessions()).toBe(2);
    // The active replacement B still works too.
    expect((await refresh(cookieOf(b))).status).toBe(200);
  });

  it("starts the grace period at the rotation and ends it after 5 seconds", async () => {
    expect(REFRESH_GRACE_MS).toBe(5_000);
    const inside = await signIn();
    await refresh(inside.cookie);
    await api.prisma.authSession.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - REFRESH_GRACE_MS + 1_500) },
    });

    expect((await refresh(inside.cookie)).status).toBe(200);

    const outside = await signIn();
    await refresh(outside.cookie);
    await api.prisma.authSession.updateMany({
      where: { revokedAt: { not: null }, graceReusedAt: null },
      data: { revokedAt: new Date(Date.now() - REFRESH_GRACE_MS - 1) },
    });
    const late = await refresh(outside.cookie);

    expect(late.status).toBe(401);
    expect(late.body).toEqual(INVALID_REFRESH);
  });

  it("rejects A after the grace period and revokes the whole family (B included)", async () => {
    const { cookie } = await signIn();
    const b = cookieOf(await refresh(cookie));
    await expireGrace();

    const reuse = await refresh(cookie);

    expect(reuse.status).toBe(401);
    expect(await activeSessions()).toBe(0);
    expect((await refresh(b)).status).toBe(401);
  });

  it("allows only ONE grace reuse: a third use of A is replay and revokes the family", async () => {
    const { cookie } = await signIn();
    const b = cookieOf(await refresh(cookie));
    const c = cookieOf(await refresh(cookie));

    const third = await refresh(cookie);

    expect(third.status).toBe(401);
    expect(third.body).toEqual(INVALID_REFRESH);
    expect(await activeSessions()).toBe(0);
    expect((await refresh(b)).status).toBe(401);
    expect((await refresh(c)).status).toBe(401);
    const graced = await api.prisma.authSession.findMany({
      where: { graceReusedAt: { not: null } },
    });
    expect(graced).toHaveLength(1);
  });

  it("cannot be multiplied by concurrent replays of A after its rotation", async () => {
    const { cookie } = await signIn();
    await refresh(cookie);

    const replays = await Promise.all(Array.from({ length: 10 }, () => refresh(cookie)));

    // At most one grace reuse succeeds; the next replay revokes the family, so nothing stays valid.
    expect(replays.filter((response) => response.status === 200).length).toBeLessThanOrEqual(1);
    expect(await activeSessions()).toBe(0);
    expect(await api.prisma.authSession.count({ where: { graceReusedAt: { not: null } } })).toBe(1);
  });

  it("treats the closed half of an overlap as reuse if it is ever presented later", async () => {
    const { cookie } = await signIn();
    const [first, second] = (await Promise.all([refresh(cookie), refresh(cookie)])).map(
      (response) => cookieOf(response),
    );
    await refresh(second);

    const orphan = await refresh(first);

    expect(orphan.status).toBe(401);
    expect(await activeSessions()).toBe(0);
  });

  it("gives no grace once the replacement is gone (logout)", async () => {
    const { cookie } = await signIn();
    const b = await refresh(cookie);
    await api.request("POST", "/api/v1/auth/logout", undefined, bearer(b.body.accessToken));

    const again = await refresh(cookie);

    expect(again.status).toBe(401);
    expect(await activeSessions()).toBe(0);
  });

  it("logout after an overlap revokes both halves", async () => {
    const { cookie } = await signIn();
    const responses = await Promise.all([refresh(cookie), refresh(cookie)]);

    const logout = await api.request(
      "POST",
      "/api/v1/auth/logout",
      undefined,
      bearer(responses[1].body.accessToken),
    );

    expect(logout.status).toBe(204);
    expect(await activeSessions()).toBe(0);
    for (const response of responses) {
      expect((await refresh(cookieOf(response))).status).toBe(401);
    }
  });

  it("gives no grace for an expired token or an inactive user", async () => {
    const expired = await signIn();
    await refresh(expired.cookie);
    await api.prisma.authSession.updateMany({
      where: { revokedAt: { not: null } },
      data: {
        createdAt: new Date(Date.now() - 40 * 86_400_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    expect((await refresh(expired.cookie)).status).toBe(401);

    const inactive = await signIn();
    await refresh(inactive.cookie);
    await api.prisma.user.updateMany({ data: { status: "INACTIVE" } });
    expect((await refresh(inactive.cookie)).status).toBe(401);
    expect(await activeSessions()).toBe(0);
  });

  it("never refreshes a revoked family again", async () => {
    const { cookie } = await signIn();
    const b = cookieOf(await refresh(cookie));
    await expireGrace();
    await refresh(cookie);

    for (const token of [cookie, b]) {
      expect((await refresh(token)).status).toBe(401);
    }
    expect(await activeSessions()).toBe(0);
  });

  it("logs the grace reuse without any token or id", async () => {
    const { cookie } = await signIn();
    const responses = await Promise.all([refresh(cookie), refresh(cookie)]);

    const line = logger.lines.find((entry) => entry.includes("Refresh grace reuse"));
    expect(line).toBeDefined();
    const sessions = await api.prisma.authSession.findMany();
    for (const value of [
      cookie.split("=")[1],
      ...responses.map((response) => cookieOf(response).split("=")[1]),
      ...sessions.map((session) => session.id),
      ...sessions.map((session) => session.userId),
    ]) {
      expect(line).not.toContain(value);
    }
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("deletes the guest account with all its data and clears the cookie (204)", async () => {
    const signedIn = await signIn();
    const other = await signIn();
    const userId = signedIn.body.user.id;
    await api.prisma.financialProfile.create({
      data: { userId, monthlyIncome: "100000.00" },
    });
    await api.prisma.financialGoal.create({
      data: { userId, type: "SAVINGS", name: "Goal", targetAmount: "1000.00" },
    });

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
    expect(await api.prisma.user.findUnique({ where: { id: userId } })).toBeNull();
    expect(await api.prisma.authSession.count({ where: { userId } })).toBe(0);
    expect(await api.prisma.financialProfile.count({ where: { userId } })).toBe(0);
    expect(await api.prisma.financialGoal.count({ where: { userId } })).toBe(0);
    expect((await refresh(signedIn.cookie)).status).toBe(401);
    // Other guests are untouched.
    expect((await refresh(other.cookie)).status).toBe(200);
  });

  it("leaves the deleted account unusable for an access token that has not expired yet", async () => {
    const signedIn = await signIn();
    const headers = bearer(signedIn.body.accessToken);
    await api.request("POST", "/api/v1/auth/logout", undefined, headers);

    expect((await api.request("GET", "/api/v1/auth/me", undefined, headers)).body).toEqual(
      AUTHENTICATION_FAILED,
    );
    expect((await api.request("GET", "/api/v1/me", undefined, headers)).status).toBe(404);
  });

  it("is idempotent", async () => {
    const signedIn = await signIn();
    const headers = bearer(signedIn.body.accessToken);

    expect((await api.request("POST", "/api/v1/auth/logout", undefined, headers)).status).toBe(204);
    expect((await api.request("POST", "/api/v1/auth/logout", undefined, headers)).status).toBe(204);
  });

  it("never deletes an ADMIN account: it only ends that sign-in", async () => {
    const signedIn = await signIn();
    const userId = signedIn.body.user.id;
    await api.prisma.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
    const admin = await refresh(signedIn.cookie);

    const response = await api.request(
      "POST",
      "/api/v1/auth/logout",
      undefined,
      bearer(admin.body.accessToken),
    );

    expect(response.status).toBe(204);
    expect(await api.prisma.user.findUnique({ where: { id: userId } })).not.toBeNull();
    expect(await activeSessions()).toBe(0);
  });

  it("requires an access token", async () => {
    const response = await api.request("POST", "/api/v1/auth/logout");

    expect(response.status).toBe(401);
    expect(response.body).toEqual(MISSING_TOKEN);
  });
});

describe("GET /api/v1/auth/me", () => {
  it("returns the minimal identity, without the display name or financial data", async () => {
    const signedIn = await signIn({ preferredLanguage: "TA", displayName: "Private Name" });

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
    expect(response.text).not.toContain("Private Name");
  });

  it("answers 401 for a user who was deactivated or deleted after signing in", async () => {
    const signedIn = await signIn();
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
    const user = await api.prisma.user.create({ data: { preferredLanguage: "EN" } });
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
  it("signing up never makes anyone an ADMIN", async () => {
    const signedIn = await signIn();

    expect(signedIn.body.user.role).toBe("USER");
    expect(await api.prisma.user.count({ where: { role: "ADMIN" } })).toBe(0);
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
        ["POST", "/api/v1/auth/guest"],
        ["POST", "/api/v1/auth/refresh"],
        ["GET", "/api/v1/me"],
        ["GET", "/api/v1/auth/me"],
        ["GET", `/api/v1/users/${randomUUID()}`],
      ] as const) {
        const response = await disabled.request(
          method,
          path,
          path.endsWith("guest") ? { preferredLanguage: "EN" } : undefined,
        );
        expect(response.status, path).toBe(503);
        expect(response.body, path).toEqual(unavailable);
      }
      expect(await disabled.prisma.user.count()).toBe(0);
      expect((await disabled.request("GET", "/api/v1/knowledge/categories")).status).toBe(200);
      expect((await disabled.request("GET", "/health")).status).toBe(200);
    } finally {
      await disabled.close();
    }
  });
});

describe("credential hygiene", () => {
  it("never writes tokens or secrets to the logs", async () => {
    // A full cycle, including reuse detection (which logs a warning) and logout.
    const { body, cookie } = await signIn({ preferredLanguage: "SI", displayName: "Private Name" });
    await refresh(cookie);
    await expireGrace();
    await refresh(cookie);
    await api.request("POST", "/api/v1/auth/logout", undefined, bearer(body.accessToken));

    expect(logger.lines.join("\n")).toContain("token family revoked");
    const log = logger.lines.join("\n");
    for (const value of sensitive) {
      if (value.length >= 8) {
        expect(log).not.toContain(value);
      }
    }
    expect(log).not.toContain("Private Name");
    expect(log).not.toMatch(/authorization|cookie|Bearer /iu);
  });

  it("records nothing about authentication in analytics", async () => {
    const signedIn = await signIn();
    await refresh(signedIn.cookie);
    await api.request("POST", "/api/v1/auth/logout", undefined, bearer(signedIn.body.accessToken));

    expect(await api.prisma.analyticsEvent.count()).toBe(0);
  });
});
