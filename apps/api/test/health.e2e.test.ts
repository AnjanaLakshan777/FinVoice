import type { ApiConfig } from "@finvoice/config";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/app.setup.js";
import { API_CONFIG } from "../src/config/api-config.module.js";
import { PrismaService } from "../src/database/prisma.service.js";

const TEST_CONFIG: ApiConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  database: { url: "postgresql://unused:unused@127.0.0.1:1/unused" },
  gemini: { apiKey: null, model: "gemini-test-model" },
  internal: { token: null },
};

describe("health endpoints", () => {
  const ping = vi.fn<() => Promise<void>>();
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_CONFIG)
      .useValue(TEST_CONFIG)
      .overrideProvider(PrismaService)
      .useValue({ ping })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    ping.mockReset();
  });

  it("GET /health reports the API as alive without touching the database", async () => {
    const response = await fetch(new URL("/health", baseUrl));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ status: "ok", service: "finvoice-api" });
    expect(ping).not.toHaveBeenCalled();
  });

  it("GET /health/ready reports ready when the database responds", async () => {
    ping.mockResolvedValue(undefined);

    const response = await fetch(new URL("/health/ready", baseUrl));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "finvoice-api",
      checks: { database: "up" },
    });
  });

  it("GET /health/ready responds 503 when the database is unreachable", async () => {
    ping.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const response = await fetch(new URL("/health/ready", baseUrl));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      service: "finvoice-api",
      checks: { database: "down" },
    });
  });

  it("keeps health checks outside the versioned API prefix", async () => {
    const response = await fetch(new URL("/api/v1/health", baseUrl));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Route not found",
    });
  });
});
