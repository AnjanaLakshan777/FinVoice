import type { ApiErrorResponse, UserResponse } from "@finvoice/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { startTestApi, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";

const WRONG_PASSWORD = "Wr0ng-Secret-Pw";

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await truncateAllTables(api.prisma);
});

/** Strings that must never appear in a response body. */
function leakCandidates(databaseUrl: string): string[] {
  const url = new URL(databaseUrl);
  return [
    databaseUrl,
    `${url.hostname}:${url.port}`,
    `:${decodeURIComponent(url.password)}@`,
    "postgres://",
    "postgresql://",
    "prisma",
    "Prisma",
    "SELECT",
    "INSERT",
    "violates",
    "users_phone_number_key",
    "_check",
    "_fkey",
    "    at ",
  ];
}

function expectNoLeaks(text: string, databaseUrl: string): void {
  for (const candidate of leakCandidates(databaseUrl)) {
    expect(text, `response leaked ${JSON.stringify(candidate)}`).not.toContain(candidate);
  }
}

describe("error safety", () => {
  it("turns a database unique violation into 409, even for concurrent requests", async () => {
    const body = { phoneNumber: "+94000000501", preferredLanguage: "SI" };

    // Both requests pass validation; the database's unique index decides which one wins.
    const responses = await Promise.all([
      api.request<UserResponse>("POST", "/api/v1/users", body),
      api.request<UserResponse>("POST", "/api/v1/users", body),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await api.prisma.user.count()).toBe(1);
  });

  it.each([
    ["GET", "/api/v1/users/123"],
    ["PATCH", "/api/v1/users/123"],
    ["GET", "/api/v1/users/123/financial-profile"],
    ["PUT", "/api/v1/users/123/financial-profile"],
    ["GET", "/api/v1/users/123/goals"],
    ["POST", "/api/v1/users/123/goals"],
    ["GET", "/api/v1/users/00000000-0000-7000-8000-000000000001/goals/123"],
    ["PATCH", "/api/v1/users/00000000-0000-7000-8000-000000000001/goals/123"],
  ])("%s %s rejects a malformed id with 400", async (method, path) => {
    const response = await api.request(method, path, method === "GET" ? undefined : {});

    expect(response.status).toBe(400);
    expect((response.body as ApiErrorResponse).code).toBe("VALIDATION_ERROR");
  });

  it("never exposes database details or credentials in error responses", async () => {
    const created = await api.request<UserResponse>("POST", "/api/v1/users", {
      phoneNumber: "+94000000502",
      preferredLanguage: "TA",
    });
    const userId = created.body.id;
    const goal = await api.request<{ id: string }>("POST", `/api/v1/users/${userId}/goals`, {
      type: "SAVINGS",
      name: "Bicycle",
      targetAmount: "45000",
    });

    const responses = await Promise.all([
      api.request("POST", "/api/v1/users", {
        phoneNumber: "+94000000502",
        preferredLanguage: "SI",
      }),
      api.request("POST", "/api/v1/users", { phoneNumber: "bad", isAdmin: true }),
      api.request("GET", "/api/v1/users/00000000-0000-7000-8000-00000000dead"),
      api.request("PUT", `/api/v1/users/${userId}/financial-profile`, { monthlyIncome: "-1" }),
      api.request("PATCH", `/api/v1/users/${userId}/goals/${goal.body.id}`, {
        currentAmount: "99999",
      }),
      api.request("GET", "/api/v1/unknown-route"),
    ]);

    expect(responses.map((response) => response.status)).toEqual([409, 400, 404, 400, 400, 404]);
    for (const response of responses) {
      expectNoLeaks(response.text, inject("databaseUrl"));
    }
  });

  it("answers 503 without leaking credentials when the database rejects the connection", async () => {
    const badUrl = new URL(inject("databaseUrl"));
    badUrl.password = WRONG_PASSWORD;
    const misconfigured = await startTestApi(badUrl.toString());

    try {
      const response = await misconfigured.request(
        "GET",
        "/api/v1/users/00000000-0000-7000-8000-000000000001",
      );
      const readiness = await misconfigured.request("GET", "/health/ready");

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        statusCode: 503,
        code: "SERVICE_UNAVAILABLE",
        message: "The database is unavailable",
      });
      expect(readiness.status).toBe(503);
      for (const text of [response.text, readiness.text]) {
        expect(text).not.toContain(WRONG_PASSWORD);
        expectNoLeaks(text, badUrl.toString());
      }
    } finally {
      await misconfigured.close();
    }
  });
});

describe("health endpoints against PostgreSQL", () => {
  it("GET /health reports liveness at the root, outside /api/v1", async () => {
    const response = await api.request("GET", "/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "finvoice-api" });
    expect((await api.request("GET", "/api/v1/health")).status).toBe(404);
  });

  it("GET /health/ready reports the database as up", async () => {
    const response = await api.request("GET", "/health/ready");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "finvoice-api",
      checks: { database: "up" },
    });
  });
});
