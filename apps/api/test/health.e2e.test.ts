import type { ApiConfig } from "@finvoice/config";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import { API_CONFIG } from "../src/config/api-config.module.js";
import { PrismaService } from "../src/database/prisma.service.js";

const TEST_CONFIG: ApiConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  database: { url: "postgresql://unused:unused@127.0.0.1:1/unused" },
};

describe("health endpoints", () => {
  const ping = vi.fn<() => Promise<void>>();
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_CONFIG)
      .useValue(TEST_CONFIG)
      .overrideProvider(PrismaService)
      .useValue({ ping })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
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
});
