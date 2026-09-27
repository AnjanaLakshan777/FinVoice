import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// Builds the API exactly as for deployment (`nest build`, which also emits the decorator metadata
// Nest's dependency injection needs) and starts the REAL production entry point, dist/main.js
// (NestFactory + configureApp), as a separate Node.js process against the test database. The other
// tests use Nest's testing module, which could hide differences in the bootstrap.

const API_DIR = fileURLToPath(new URL("../..", import.meta.url));
const TOKEN = "production-bootstrap-test-token-0123456789abcdef";
const NOT_FOUND = { statusCode: 404, code: "NOT_FOUND", message: "Route not found" };

let child: ChildProcess;
let baseUrl: string;
let output = "";

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

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The API did not start:\n${output}`);
}

beforeAll(async () => {
  const nest = createRequire(import.meta.url).resolve("@nestjs/cli/bin/nest.js");
  const build = spawnSync(process.execPath, [nest, "build"], { cwd: API_DIR, encoding: "utf8" });
  if (build.status !== 0) {
    throw new Error(`nest build failed:
${build.stdout}
${build.stderr}`);
  }
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${String(port)}`;
  child = spawn(process.execPath, ["--enable-source-maps", "dist/main.js"], {
    cwd: API_DIR,
    env: {
      ...process.env,
      NODE_ENV: "production",
      API_HOST: "127.0.0.1",
      API_PORT: String(port),
      DATABASE_URL: inject("databaseUrl"),
      INTERNAL_API_TOKEN: TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  await waitForHealth();
}, 240_000);

afterAll(() => {
  child.kill();
});

async function call(method: string, path: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers });
  const text = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    text,
    json: JSON.parse(text) as unknown,
  };
}

describe("production bootstrap (nest build + dist/main.js)", () => {
  it.each([
    ["GET", "/internal/does-not-exist"],
    ["GET", "/api/v1/does-not-exist"],
    ["GET", "/does-not-exist"],
    ["GET", "/internal/admin/analytics/does-not-exist"],
    ["POST", "/internal/analytics/nothing"],
    ["GET", "/internal/analytics/events"],
  ])("answers %s %s with the JSON 404 format", async (method, path) => {
    const response = await call(method, path, { "x-finvoice-internal-token": TOKEN });

    expect(response.status).toBe(404);
    expect(response.contentType).toMatch(/^application\/json/u);
    expect(response.json).toEqual(NOT_FOUND);
    expect(response.text).not.toMatch(/Cannot|<html|stack/u);
  });

  it("answers an internal route without the token with a JSON 401, not a 500", async () => {
    const response = await call("GET", "/internal/admin/analytics/overview");

    expect(response.status).toBe(401);
    expect(response.json).toEqual({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Missing or invalid internal token",
    });
  });

  it("keeps the health endpoints working", async () => {
    const live = await call("GET", "/health");
    const ready = await call("GET", "/health/ready");

    expect(live).toMatchObject({ status: 200, json: { status: "ok", service: "finvoice-api" } });
    expect(ready).toMatchObject({
      status: 200,
      json: { status: "ok", service: "finvoice-api", checks: { database: "up" } },
    });
  });

  it("serves a real internal route with the token", async () => {
    const response = await call("GET", "/internal/admin/analytics/overview", {
      "x-finvoice-internal-token": TOKEN,
    });
    expect(response.status, output).toBe(200);
  });

  it("never logs the internal token", () => {
    expect(output).not.toContain(TOKEN);
  });
});
