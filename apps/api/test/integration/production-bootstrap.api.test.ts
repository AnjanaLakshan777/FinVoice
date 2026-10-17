import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

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

  it("never logs the internal token or the auth secret", () => {
    expect(production.output()).not.toContain(TOKEN);
    expect(production.output()).not.toContain(JWT_SECRET);
  });
});

describe("production refuses unsafe authentication configuration", () => {
  it.each([
    ["a missing JWT secret", { AUTH_JWT_SECRET: "" }, "AUTH_JWT_SECRET"],
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
      for (const value of [JWT_SECRET, ...Object.values(overrides)]) {
        if (value.length >= 8) {
          expect(result.output).not.toContain(value);
        }
      }
    },
  );

  it("starts with leftover OTP settings from an older environment file, and ignores them", async () => {
    const leftover = secret();
    const api = await startApi({
      NODE_ENV: "production",
      AUTH_OTP_PEPPER: leftover,
      AUTH_OTP_PROVIDER: "dev",
      AUTH_OTP_DEV_CODE: "12345678",
    });
    try {
      expect((await call(api, "GET", "/health")).status).toBe(200);
      expect(api.output()).not.toContain(leftover);
    } finally {
      api.child.kill();
    }
  }, 60_000);
});

// The complete guest flow over real HTTP against the production build.
describe("guest authentication flow on the production build", () => {
  it("signs in, uses the session, rotates, detects reuse, and logout deletes the account", async () => {
    const created = await call(production, "POST", "/api/v1/auth/guest", {
      body: { preferredLanguage: "SI", displayName: "Bootstrap Guest" },
    });
    expect(created.status, production.output()).toBe(201);
    const signedIn = created.json as {
      accessToken: string;
      user: { id: string; role: string };
    };
    expect(signedIn.user.role).toBe("USER");
    const setCookie = created.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^finvoice_refresh=[A-Za-z0-9_-]{43}; /u);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/api/v1/auth");
    const firstCookie = setCookie.split(";")[0] ?? "";
    expect(created.text).not.toContain(firstCookie.split("=")[1]);
    const bearer = { authorization: `Bearer ${signedIn.accessToken}` };

    const me = await call(production, "GET", "/api/v1/auth/me", { headers: bearer });
    expect(me).toMatchObject({
      status: 200,
      json: { id: signedIn.user.id, role: "USER", status: "ACTIVE", preferredLanguage: "SI" },
    });

    for (const path of [
      "/api/v1/me",
      "/api/v1/me/financial-context",
      "/api/v1/me/literacy-context",
      "/api/v1/me/goals",
      `/api/v1/users/${signedIn.user.id}`,
      `/api/v1/users/${signedIn.user.id}/goals`,
    ]) {
      const response = await call(production, "GET", path, { headers: bearer });
      expect(response.status, path).toBe(200);
    }
    const otherUser = await call(
      production,
      "GET",
      "/api/v1/users/00000000-0000-7000-8000-000000000001",
      { headers: bearer },
    );
    expect(otherUser.status).toBe(404);

    const refreshed = await call(production, "POST", "/api/v1/auth/refresh", {
      headers: { cookie: firstCookie },
    });
    expect(refreshed.status).toBe(200);
    const secondCookie = (refreshed.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect(secondCookie).not.toBe(firstCookie);

    // The first token again, after the short grace period for overlapping refreshes (a reload
    // race) has passed: reuse. The whole family is revoked, including the new token.
    await new Promise((resolve) => setTimeout(resolve, 5_500));
    const reused = await call(production, "POST", "/api/v1/auth/refresh", {
      headers: { cookie: firstCookie },
    });
    expect(reused.status).toBe(401);
    const afterReuse = await call(production, "POST", "/api/v1/auth/refresh", {
      headers: { cookie: secondCookie },
    });
    expect(afterReuse.status).toBe(401);

    // A new guest, then logout deletes that account.
    const again = await call(production, "POST", "/api/v1/auth/guest", {
      body: { preferredLanguage: "EN" },
    });
    expect(again.status).toBe(201);
    const second = again.json as { accessToken: string; user: { id: string } };
    expect(second.user.id).not.toBe(signedIn.user.id);
    const cookie = (again.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const secondBearer = { authorization: `Bearer ${second.accessToken}` };
    const logout = await call(production, "POST", "/api/v1/auth/logout", { headers: secondBearer });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toMatch(/^finvoice_refresh=; Max-Age=0; /u);
    const afterLogout = await call(production, "POST", "/api/v1/auth/refresh", {
      headers: { cookie },
    });
    expect(afterLogout.status).toBe(401);
    expect(
      (await call(production, "GET", "/api/v1/auth/me", { headers: secondBearer })).status,
    ).toBe(401);

    // Nothing sensitive in the server's output.
    const log = production.output();
    for (const value of [signedIn.accessToken, second.accessToken, JWT_SECRET, "Bootstrap Guest"]) {
      expect(log).not.toContain(value);
    }
    for (const value of [firstCookie, secondCookie, cookie]) {
      expect(log).not.toContain(value.split("=")[1]);
    }
  });
});
