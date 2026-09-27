import { Body, Controller, Get, Module, Post } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { configureApp } from "../src/app.setup.js";
import { redactSecrets } from "../src/common/api-exception.filter.js";
import { Prisma } from "../src/generated/prisma/client.js";

const SECRET_URL = "postgresql://finvoice:Sup3r-Secret-Pw@db.internal:5432/finvoice";

function prismaError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(
    `Invalid \`prisma.user.create()\` invocation: constraint "users_phone_number_key" (${SECRET_URL})`,
    { code, clientVersion: "7.10.0", ...(meta ? { meta } : {}) },
  );
}

/** Routes that fail in controlled ways, to test the global pipe and filter without a database. */
@Controller("probe")
class ProbeController {
  @Get("unexpected")
  unexpected(): never {
    throw new Error(`connect failed for ${SECRET_URL}`);
  }

  @Get("unique")
  unique(): never {
    throw prismaError("P2002");
  }

  @Get("missing")
  missing(): never {
    throw prismaError("P2025");
  }

  @Get("check")
  check(): never {
    throw prismaError("P2039", { driverAdapterError: { cause: { originalCode: "23514" } } });
  }

  @Get("offline")
  offline(): never {
    throw prismaError("P1001");
  }

  @Post("validated")
  validated(@Body({ schema: z.strictObject({ amount: z.string() }) }) body: { amount: string }) {
    return body;
  }

  @Post("unvalidated")
  unvalidated(@Body() body: unknown): unknown {
    return body;
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe("global validation and error handling", () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    await configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  async function call(method: string, path: string, body?: string) {
    const response = await fetch(new URL(`/api/v1${path}`, baseUrl), {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body }),
    });
    const text = await response.text();
    return {
      status: response.status,
      text,
      json: JSON.parse(text) as unknown,
      headers: response.headers,
    };
  }

  it("turns unexpected errors into a generic 500 without internal details", async () => {
    const response = await call("GET", "/probe/unexpected");

    expect(response.status).toBe(500);
    expect(response.json).toEqual({
      statusCode: 500,
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    });
    expect(response.text).not.toContain("Sup3r-Secret-Pw");
  });

  it.each([
    ["/probe/unique", 409, "CONFLICT"],
    ["/probe/missing", 404, "NOT_FOUND"],
    ["/probe/check", 409, "CONFLICT"],
    ["/probe/offline", 503, "SERVICE_UNAVAILABLE"],
  ])(
    "maps Prisma errors from %s to HTTP %i without leaking the database message",
    async (path, status, code) => {
      const response = await call("GET", path);

      expect(response.status).toBe(status);
      expect(response.json).toMatchObject({ statusCode: status, code });
      for (const leaked of [
        "Sup3r-Secret-Pw",
        "postgresql://",
        "users_phone_number_key",
        "prisma",
      ]) {
        expect(response.text).not.toContain(leaked);
      }
    },
  );

  it("returns validation errors in the API format", async () => {
    const response = await call(
      "POST",
      "/probe/validated",
      JSON.stringify({ amount: 1, extra: true }),
    );

    expect(response.status).toBe(400);
    expect(response.json).toMatchObject({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
    });
    const details = (response.json as { details: { field: string | null }[] }).details;
    expect(details.map((detail) => detail.field)).toEqual(expect.arrayContaining(["amount", null]));
  });

  it("fails closed when a route accepts a body without declaring a schema", async () => {
    const response = await call("POST", "/probe/unvalidated", JSON.stringify({ anything: true }));

    expect(response.status).toBe(500);
    expect(response.json).toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("rejects malformed JSON with a fixed message", async () => {
    const response = await call("POST", "/probe/validated", '{"amount": "1",');

    expect(response.status).toBe(400);
    expect(response.json).toEqual({
      statusCode: 400,
      code: "BAD_REQUEST",
      message: "The request could not be processed",
    });
  });

  it("rejects request bodies over 100 kB", async () => {
    const response = await call(
      "POST",
      "/probe/validated",
      JSON.stringify({ amount: "x".repeat(110_000) }),
    );

    expect(response.status).toBe(413);
    expect(response.json).toEqual({
      statusCode: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body is too large",
    });
  });

  it("answers unknown routes with the API error format", async () => {
    const response = await call("GET", "/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.json).toEqual({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Route not found",
    });
  });

  it.each([
    ["GET", "/does-not-exist"],
    ["GET", "/internal/does-not-exist"],
    ["POST", "/internal/analytics/nothing-here"],
    ["GET", "/health/nope"],
    ["DELETE", "/api/v2/users"],
  ])(
    "answers %s %s (outside /api/v1) with the same JSON 404, not an HTML page",
    async (method, path) => {
      const response = await fetch(new URL(path, baseUrl), { method });
      const text = await response.text();

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toMatch(/^application\/json/u);
      expect(JSON.parse(text)).toEqual({
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Route not found",
      });
      // The path is not echoed, and nothing reveals the framework.
      expect(text).not.toContain(path);
      expect(text).not.toMatch(/Cannot|<html|Error:/u);
    },
  );

  it("does not advertise the server framework", async () => {
    const response = await call("GET", "/does-not-exist");

    expect(response.headers.get("x-powered-by")).toBeNull();
  });
});

describe("redactSecrets", () => {
  it("removes connection strings from log output", () => {
    expect(redactSecrets(`failed: ${SECRET_URL} (retrying)`)).toBe(
      "failed: postgresql://[redacted] (retrying)",
    );
  });
});
