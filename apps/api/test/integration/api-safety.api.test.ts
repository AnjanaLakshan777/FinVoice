import type { ApiErrorResponse } from "@finvoice/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { startTestApi, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";

const WRONG_PASSWORD = "Wr0ng-Secret-Pw";
const SOME_USER_ID = "00000000-0000-7000-8000-000000000001";

let api: TestApi;
/** A validly signed access token for the user SOME_USER_ID. */
let someUser: Record<string, string>;

beforeAll(async () => {
  api = await startTestApi();
  someUser = await api.authHeaders(SOME_USER_ID);
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
    "_pkey",
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
  it.each([
    ["GET", "/api/v1/users/123"],
    ["PATCH", "/api/v1/users/123"],
    ["GET", "/api/v1/users/123/financial-profile"],
    ["PUT", "/api/v1/users/123/financial-profile"],
    ["GET", "/api/v1/users/123/goals"],
    ["POST", "/api/v1/users/123/goals"],
    ["GET", `/api/v1/users/${SOME_USER_ID}/goals/123`],
    ["PATCH", `/api/v1/users/${SOME_USER_ID}/goals/123`],
  ])("%s %s rejects a malformed id with 400", async (method, path) => {
    const response = await api.request(method, path, method === "GET" ? undefined : {}, someUser);

    expect(response.status).toBe(400);
    expect((response.body as ApiErrorResponse).code).toBe("VALIDATION_ERROR");
  });

  it("never exposes database details or credentials in error responses", async () => {
    const userId = (await api.prisma.user.create({ data: { preferredLanguage: "TA" } })).id;
    const own = await api.authHeaders(userId);
    const goal = await api.request<{ id: string }>(
      "POST",
      `/api/v1/users/${userId}/goals`,
      { type: "SAVINGS", name: "Bicycle", targetAmount: "45000" },
      own,
    );
    const unknownId = "00000000-0000-7000-8000-00000000dead";

    const responses = await Promise.all([
      api.request("POST", "/api/v1/auth/guest", { preferredLanguage: "bad", isAdmin: true }),
      api.request("GET", `/api/v1/users/${unknownId}`, undefined, await api.authHeaders(unknownId)),
      api.request("PUT", `/api/v1/users/${userId}/financial-profile`, { monthlyIncome: "-1" }, own),
      api.request(
        "PATCH",
        `/api/v1/users/${userId}/goals/${goal.body.id}`,
        { currentAmount: "99999" },
        own,
      ),
      api.request("GET", "/api/v1/unknown-route"),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 404, 400, 400, 404]);
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
        `/api/v1/users/${SOME_USER_ID}`,
        undefined,
        await misconfigured.authHeaders(SOME_USER_ID),
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
