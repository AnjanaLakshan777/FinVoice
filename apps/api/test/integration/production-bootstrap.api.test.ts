import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { randomOtpCode } from "../support/auth.js";

// Builds the API exactly as for deployment (`nest build`, which also emits the decorator metadata
// Nest's dependency injection needs) and starts the REAL entry point, dist/main.js (NestFactory +
// configureApp), as separate Node.js processes against the test database. The other tests use
// Nest's testing module, which could hide differences in the bootstrap.
//
// Every secret below is generated randomly in this process and never printed.

const API_DIR = fileURLToPath(new URL("../..", import.meta.url));
const TOKEN = "production-bootstrap-test-token-0123456789abcdef";
const NOT_FOUND = { statusCode: 404, code: "NOT_FOUND", message: "Route not found" };

const secret = (): string => randomBytes(32).toString("base64url");
const JWT_SECRET = secret();
const OTP_PEPPER = secret();

type RunningApi = { baseUrl: string; child: ChildProcess; output: () => string };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

type EnvOverrides = Record<string, string | undefined>;

/**
 * Environment for dist/main.js: the test process's, with every auth variable set explicitly. An
 * override of undefined removes the variable entirely.
 */
function apiEnv(port: number, overrides: EnvOverrides): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    API_HOST: "127.0.0.1",
    API_PORT: String(port),
    DATABASE_URL: inject("databaseUrl"),
    INTERNAL_API_TOKEN: TOKEN,
    AUTH_JWT_SECRET: JWT_SECRET,
    AUTH_OTP_PEPPER: OTP_PEPPER,
    AUTH_OTP_PROVIDER: "",
    AUTH_OTP_DEV_CODE: "",
    AUTH_REFRESH_COOKIE_SECURE: "",
    ...overrides,
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- removing a variable
      delete env[name];
    }
  }
  return env;
}

async function startApi(overrides: EnvOverrides): Promise<RunningApi> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  let output = "";
  const child = spawn(process.execPath, ["--enable-source-maps", "dist/main.js"], {
    cwd: API_DIR,
    env: apiEnv(port, overrides),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return { baseUrl, child, output: () => output };
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`The API did not start:\n${output}`);
}

/** Starts dist/main.js with a configuration that must be refused; resolves with its exit. */
async function startRefused(
  overrides: EnvOverrides,
): Promise<{ code: number | null; output: string }> {
  const port = await freePort();
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(process.execPath, ["dist/main.js"], {
      cwd: API_DIR,
      env: apiEnv(port, overrides),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill(), 45_000);
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

async function call(
  api: RunningApi,
  method: string,
  path: string,
  { headers = {}, body }: { headers?: Record<string, string>; body?: unknown } = {},
) {
  const response = await fetch(`${api.baseUrl}${path}`, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    headers: response.headers,
    text,
    json: (text ? JSON.parse(text) : undefined) as unknown,
  };
}

let production: RunningApi;

beforeAll(async () => {
  const nest = createRequire(import.meta.url).resolve("@nestjs/cli/bin/nest.js");
  const build = spawnSync(process.execPath, [nest, "build"], { cwd: API_DIR, encoding: "utf8" });
  if (build.status !== 0) {
    throw new Error(`nest build failed:
${build.stdout}
${build.stderr}`);
  }
  production = await startApi({ NODE_ENV: "production" });
}, 240_000);

afterAll(() => {
  production.child.kill();
});

describe("production bootstrap (nest build + dist/main.js)", () => {
  it.each([
    ["GET", "/internal/does-not-exist"],
    ["GET", "/api/v1/does-not-exist"],
    ["GET", "/does-not-exist"],
    ["GET", "/internal/admin/analytics/does-not-exist"],
    ["POST", "/internal/analytics/nothing"],
    ["GET", "/internal/analytics/events"],
  ])("answers %s %s with the JSON 404 format", async (method, path) => {
    const response = await call(production, method, path, {
      headers: { "x-finvoice-internal-token": TOKEN },
    });

    expect(response.status).toBe(404);
    expect(response.contentType).toMatch(/^application\/json/u);
    expect(response.json).toEqual(NOT_FOUND);
    expect(response.text).not.toMatch(/Cannot|<html|stack/u);
  });

  it("answers an internal route without the token with a JSON 401, not a 500", async () => {
    const response = await call(production, "GET", "/internal/admin/analytics/overview");

    expect(response.status).toBe(401);
    expect(response.json).toEqual({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Missing or invalid internal token",
    });
  });

  it("keeps the health endpoints working", async () => {
    const live = await call(production, "GET", "/health");
    const ready = await call(production, "GET", "/health/ready");

    expect(live).toMatchObject({ status: 200, json: { status: "ok", service: "finvoice-api" } });
    expect(ready).toMatchObject({
      status: 200,
      json: { status: "ok", service: "finvoice-api", checks: { database: "up" } },
    });
  });

  it("serves a real internal route with the token", async () => {
    const response = await call(production, "GET", "/internal/admin/analytics/overview", {
      headers: { "x-finvoice-internal-token": TOKEN },
    });
    expect(response.status, production.output()).toBe(200);
  });

  it.each([
    ["GET", "/api/v1/auth/me"],
    ["GET", "/api/v1/me"],
    ["GET", "/api/v1/me/financial-context"],
    ["GET", "/api/v1/me/literacy-context"],
    ["GET", "/api/v1/users/00000000-0000-7000-8000-000000000001"],
    ["GET", "/api/v1/users/00000000-0000-7000-8000-000000000001/financial-profile"],
    ["GET", "/api/v1/users/00000000-0000-7000-8000-000000000001/goals"],
    ["POST", "/api/v1/users"],
    ["POST", "/api/v1/auth/logout"],
  ])("protects %s %s with a JSON 401", async (method, path) => {
    const response = await call(production, method, path);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(response.json).toEqual({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Missing or invalid access token",
    });
  });

  it("does not accept the internal token as an end-user credential", async () => {
    const response = await call(production, "GET", "/api/v1/me", {
      headers: { authorization: `Bearer ${TOKEN}`, "x-finvoice-internal-token": TOKEN },
    });
    expect(response.status).toBe(401);
  });

  it("keeps the public endpoints public", async () => {
    const response = await call(production, "GET", "/api/v1/knowledge/articles");
    expect(response.status).toBe(200);
  });

  it("has no OTP delivery in production (no real SMS provider yet): sign-in answers 503", async () => {
    const response = await call(production, "POST", "/api/v1/auth/request-otp", {
      body: { phoneNumber: "+94770000001" },
    });

    expect(response.status).toBe(503);
    expect(response.json).toEqual({
      statusCode: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "Verification code delivery is not configured",
    });
  });

  it("never logs the internal token or the auth secrets", () => {
    expect(production.output()).not.toContain(TOKEN);
    expect(production.output()).not.toContain(JWT_SECRET);
    expect(production.output()).not.toContain(OTP_PEPPER);
  });
});

describe("production refuses unsafe authentication configuration", () => {
  it.each([
    [
      "the development OTP provider",
      { AUTH_OTP_PROVIDER: "dev", AUTH_OTP_DEV_CODE: randomOtpCode() },
      "AUTH_OTP_PROVIDER",
    ],
    ["a missing JWT secret", { AUTH_JWT_SECRET: "" }, "AUTH_JWT_SECRET"],
    ["a missing OTP pepper", { AUTH_OTP_PEPPER: "" }, "AUTH_OTP_PEPPER"],
    ["a short JWT secret", { AUTH_JWT_SECRET: "too-short-secret" }, "AUTH_JWT_SECRET"],
    [
      "an insecure refresh cookie",
      { AUTH_REFRESH_COOKIE_SECURE: "false" },
      "AUTH_REFRESH_COOKIE_SECURE",
    ],
    [
      "the JWT secret reused as the internal token",
      { INTERNAL_API_TOKEN: JWT_SECRET },
      "INTERNAL_API_TOKEN",
    ],
  ])(
    "does not start with %s, and does not print secret values",
    async (_name, overrides, variable) => {
      const result = await startRefused({ NODE_ENV: "production", ...overrides });

      expect(result.code).not.toBe(0);
      expect(result.output).toContain("Invalid environment configuration");
      expect(result.output).toContain(variable);
      for (const value of [JWT_SECRET, OTP_PEPPER, ...Object.values(overrides)]) {
        if (value.length >= 8) {
          expect(result.output).not.toContain(value);
        }
      }
    },
  );
});

// The development OTP provider is allowed ONLY with NODE_ENV exactly "development" or "test".
describe("development OTP provider environment boundary (production build)", () => {
  const DEV_CODE = randomOtpCode();

  it.each([
    ["production", "production"],
    ["staging", "staging"],
    ["preview", "preview"],
    ["an unknown environment", "qa"],
    ["a differently cased value", "Development"],
    ["an unset NODE_ENV", undefined],
  ])("refuses to start with the development provider for %s", async (_case, nodeEnv) => {
    const result = await startRefused({
      NODE_ENV: nodeEnv,
      AUTH_OTP_PROVIDER: "dev",
      AUTH_OTP_DEV_CODE: DEV_CODE,
    });

    expect(result.code).not.toBe(0);
    expect(result.output).toContain("Invalid environment configuration");
    expect(result.output).toContain("AUTH_OTP_PROVIDER");
    expect(result.output).toContain("Allowed only when NODE_ENV is explicitly development or test");
    for (const secret of [DEV_CODE, JWT_SECRET, OTP_PEPPER]) {
      expect(result.output).not.toContain(secret);
    }
  });

  it("starts with the development provider for NODE_ENV=test (development: see below)", async () => {
    const api = await startApi({
      NODE_ENV: "test",
      AUTH_OTP_PROVIDER: "dev",
      AUTH_OTP_DEV_CODE: DEV_CODE,
    });
    try {
      const response = await call(api, "POST", "/api/v1/auth/request-otp", {
        body: { phoneNumber: "+94000000011" },
      });

      expect(response.status).toBe(202);
      expect(response.text).not.toContain(DEV_CODE);
      expect(api.output()).not.toContain(DEV_CODE);
    } finally {
      api.child.kill();
    }
  }, 60_000);
});

// The same build, started in development mode with the development OTP provider (configured only
// in this process's environment, never in a file): the complete sign-in flow over real HTTP.
describe("authentication flow on the production build (development OTP provider)", () => {
  const code = randomOtpCode();
  const phoneNumber = `+9477${String(randomInt(1_000_000, 10_000_000))}`;
  let dev: RunningApi;

  beforeAll(async () => {
    dev = await startApi({
      NODE_ENV: "development",
      AUTH_OTP_PROVIDER: "dev",
      AUTH_OTP_DEV_CODE: code,
    });
  }, 60_000);

  afterAll(() => {
    dev.child.kill();
  });

  it("signs in, uses the session, rotates, detects reuse and logs out", async () => {
    const requested = await call(dev, "POST", "/api/v1/auth/request-otp", {
      body: { phoneNumber },
    });
    expect(requested.status).toBe(202);
    expect(requested.text).not.toContain(code);
    const { challengeId } = requested.json as { challengeId: string };

    const verified = await call(dev, "POST", "/api/v1/auth/verify-otp", {
      body: { challengeId, code, preferredLanguage: "SI" },
    });
    expect(verified.status).toBe(200);
    const signedIn = verified.json as {
      accessToken: string;
      user: { id: string; role: string };
    };
    expect(signedIn.user.role).toBe("USER");
    const setCookie = verified.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^finvoice_refresh=[A-Za-z0-9_-]{43}; /u);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/api/v1/auth");
    const firstCookie = setCookie.split(";")[0] ?? "";
    expect(verified.text).not.toContain(firstCookie.split("=")[1]);
    const bearer = { authorization: `Bearer ${signedIn.accessToken}` };

    const me = await call(dev, "GET", "/api/v1/auth/me", { headers: bearer });
    expect(me).toMatchObject({
      status: 200,
      json: { id: signedIn.user.id, role: "USER", status: "ACTIVE", preferredLanguage: "SI" },
    });
    expect(me.text).not.toContain(phoneNumber);

    for (const path of [
      "/api/v1/me",
      "/api/v1/me/financial-context",
      "/api/v1/me/literacy-context",
      "/api/v1/me/goals",
      `/api/v1/users/${signedIn.user.id}`,
      `/api/v1/users/${signedIn.user.id}/goals`,
    ]) {
      const response = await call(dev, "GET", path, { headers: bearer });
      expect(response.status, path).toBe(200);
    }
    const otherUser = await call(dev, "GET", "/api/v1/users/00000000-0000-7000-8000-000000000001", {
      headers: bearer,
    });
    expect(otherUser.status).toBe(404);
    const admin = await call(dev, "POST", "/api/v1/users", {
      headers: bearer,
      body: { phoneNumber: "+94770000002", preferredLanguage: "EN" },
    });
    expect(admin.status).toBe(403);

    const refreshed = await call(dev, "POST", "/api/v1/auth/refresh", {
      headers: { cookie: firstCookie },
    });
    expect(refreshed.status).toBe(200);
    const secondCookie = (refreshed.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect(secondCookie).not.toBe(firstCookie);

    // The first token again, after the short grace period for overlapping refreshes (a reload
    // race) has passed: reuse. The whole family is revoked, including the new token.
    await new Promise((resolve) => setTimeout(resolve, 5_500));
    const reused = await call(dev, "POST", "/api/v1/auth/refresh", {
      headers: { cookie: firstCookie },
    });
    expect(reused.status).toBe(401);
    const afterReuse = await call(dev, "POST", "/api/v1/auth/refresh", {
      headers: { cookie: secondCookie },
    });
    expect(afterReuse.status).toBe(401);

    // A fresh sign-in (new family), then logout revokes it.
    const again = await call(dev, "POST", "/api/v1/auth/request-otp", { body: { phoneNumber } });
    const verifiedAgain = await call(dev, "POST", "/api/v1/auth/verify-otp", {
      body: { challengeId: (again.json as { challengeId: string }).challengeId, code },
    });
    expect(verifiedAgain.status).toBe(200);
    const token = (verifiedAgain.json as { accessToken: string; user: { id: string } }).accessToken;
    expect((verifiedAgain.json as { user: { id: string } }).user.id).toBe(signedIn.user.id);
    const cookie = (verifiedAgain.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const logout = await call(dev, "POST", "/api/v1/auth/logout", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toMatch(/^finvoice_refresh=; Max-Age=0; /u);
    const afterLogout = await call(dev, "POST", "/api/v1/auth/refresh", {
      headers: { cookie },
    });
    expect(afterLogout.status).toBe(401);

    // Nothing sensitive in the server's output.
    const log = dev.output();
    for (const value of [code, phoneNumber, signedIn.accessToken, token, JWT_SECRET, OTP_PEPPER]) {
      expect(log).not.toContain(value);
    }
    for (const value of [firstCookie, secondCookie, cookie]) {
      expect(log).not.toContain(value.split("=")[1]);
    }
  });
});
