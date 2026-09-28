import { randomUUID } from "node:crypto";

import {
  INTERNAL_TOKEN_HEADER,
  type FinancialContextResponse,
  type FinancialGoalResponse,
  type FinancialProfileResponse,
  type LiteracyContextResponse,
  type PaginatedResponse,
  type UserResponse,
} from "@finvoice/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startTestApi, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";

/** Test-only token; never a real secret. */
const INTERNAL_TOKEN = "internal-test-token-for-me-endpoints-0123456789";
// Fake phone numbers: "+94" followed by 0 is never assigned in Sri Lanka's numbering plan.
const PHONE_A = "+94000000701";
const PHONE_B = "+94000000702";

const ME_ROUTES: [string, string, unknown?][] = [
  ["GET", "/api/v1/me"],
  ["PATCH", "/api/v1/me", { displayName: "x" }],
  ["GET", "/api/v1/me/financial-profile"],
  ["PUT", "/api/v1/me/financial-profile", { monthlyIncome: "1.00" }],
  ["GET", "/api/v1/me/goals"],
  ["POST", "/api/v1/me/goals", { type: "SAVINGS", name: "x", targetAmount: "1.00" }],
  ["GET", `/api/v1/me/goals/${randomUUID()}`],
  ["PATCH", `/api/v1/me/goals/${randomUUID()}`, { name: "x" }],
  ["GET", "/api/v1/me/financial-context"],
  ["GET", "/api/v1/me/literacy-context"],
];

let api: TestApi;
let userA: string;
let userB: string;
let asA: Record<string, string>;

beforeAll(async () => {
  api = await startTestApi({ internalToken: INTERNAL_TOKEN });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await truncateAllTables(api.prisma);
  userA = (
    await api.prisma.user.create({
      data: { phoneNumber: PHONE_A, preferredLanguage: "SI", displayName: "Kamal" },
    })
  ).id;
  userB = (
    await api.prisma.user.create({
      data: { phoneNumber: PHONE_B, preferredLanguage: "TA", displayName: "Nimal" },
    })
  ).id;
  asA = await api.authHeaders(userA);
  // User B has private data that must never reach user A.
  await api.prisma.financialProfile.create({
    data: { userId: userB, monthlyIncome: "987654.00", monthlyExpenses: "123456.00" },
  });
  await api.prisma.financialGoal.create({
    data: { userId: userB, type: "SAVINGS", name: "B secret goal", targetAmount: "5000.00" },
  });
});

function me<T>(method: string, path: string, body?: unknown, headers = asA) {
  return api.request<T>(method, `/api/v1/me${path}`, body, headers);
}

describe("/api/v1/me access", () => {
  it.each(ME_ROUTES)("%s %s requires an access token (401)", async (method, path, body) => {
    const response = await api.request(method, path, body);

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it.each(ME_ROUTES.filter(([, path]) => !path.endsWith("/goals")))(
    "%s %s rejects a userId in the query string instead of using it",
    async (method, path, body) => {
      const response = await api.request(method, `${path}?userId=${userB}`, body, asA);

      expect(response.status).toBe(400);
      expect(response.text).not.toContain("987654");
    },
  );

  it("GET /me/goals rejects a userId in the query string", async () => {
    const response = await me("GET", `/goals?userId=${userB}`);

    expect(response.status).toBe(400);
  });

  it.each([
    ["PATCH", "", { userId: "B" }],
    ["PUT", "/financial-profile", { userId: "B", monthlyIncome: "1.00" }],
    ["POST", "/goals", { userId: "B", type: "SAVINGS", name: "x", targetAmount: "1.00" }],
  ])("%s /me%s rejects a userId in the body", async (method, path, body) => {
    const response = await me(method, path, { ...body, userId: userB });

    expect(response.status).toBe(400);
    expect(await api.prisma.financialGoal.count({ where: { userId: userA } })).toBe(0);
  });

  it("has no /me/:userId form (the identity is never a path parameter)", async () => {
    const response = await api.request("GET", `/api/v1/me/${userB}`, undefined, asA);

    expect(response.status).toBe(404);
    expect(response.text).not.toContain(PHONE_B);
  });
});

describe("GET and PATCH /api/v1/me", () => {
  it("returns the caller's own user", async () => {
    const response = await me<UserResponse>("GET", "");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: userA, displayName: "Kamal", phoneNumber: PHONE_A });
  });

  it("updates the caller's display name and language only", async () => {
    const response = await me<UserResponse>("PATCH", "", {
      displayName: "Kamal P.",
      preferredLanguage: "EN",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: userA,
      displayName: "Kamal P.",
      preferredLanguage: "EN",
    });
    expect(await api.prisma.user.findUniqueOrThrow({ where: { id: userB } })).toMatchObject({
      displayName: "Nimal",
      preferredLanguage: "TA",
    });
  });

  it.each([{ role: "ADMIN" }, { status: "INACTIVE" }, { phoneNumber: "+94000000709" }, {}])(
    "rejects %j",
    async (body) => {
      const response = await me("PATCH", "", body);

      expect(response.status).toBe(400);
      expect(await api.prisma.user.findUniqueOrThrow({ where: { id: userA } })).toMatchObject({
        role: "USER",
        status: "ACTIVE",
        phoneNumber: PHONE_A,
      });
    },
  );
});

describe("/api/v1/me/financial-profile", () => {
  it("reads and writes the caller's own profile only", async () => {
    const missing = await me("GET", "/financial-profile");
    const put = await me<FinancialProfileResponse>("PUT", "/financial-profile", {
      monthlyIncome: "150000",
      monthlyExpenses: "90000.5",
    });
    const read = await me<FinancialProfileResponse>("GET", "/financial-profile");

    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ message: "Financial profile not found" });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      userId: userA,
      monthlyIncome: "150000.00",
      monthlyExpenses: "90000.50",
    });
    expect(read.body).toEqual(put.body);
    const other = await api.prisma.financialProfile.findUniqueOrThrow({ where: { userId: userB } });
    expect(other.monthlyIncome?.toFixed(2)).toBe("987654.00");
  });

  it("applies the same validation as /users/:userId/financial-profile", async () => {
    const response = await me("PUT", "/financial-profile", { monthlyIncome: "-1" });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("/api/v1/me/goals", () => {
  it("creates, lists, reads and updates the caller's goals", async () => {
    const created = await me<FinancialGoalResponse>("POST", "/goals", {
      type: "EMERGENCY_FUND",
      name: "Rainy day",
      targetAmount: "100000",
    });
    const list = await me<PaginatedResponse<FinancialGoalResponse>>("GET", "/goals");
    const one = await me<FinancialGoalResponse>("GET", `/goals/${created.body.id}`);
    const updated = await me<FinancialGoalResponse>("PATCH", `/goals/${created.body.id}`, {
      currentAmount: "2500",
    });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ userId: userA, name: "Rainy day" });
    expect(list.body.data.map((goal) => goal.name)).toEqual(["Rainy day"]);
    expect(list.body.meta.total).toBe(1);
    expect(one.body).toEqual(created.body);
    expect(updated.body).toMatchObject({ currentAmount: "2500.00" });
  });

  it("supports the same filters and pagination as /users/:userId/goals", async () => {
    const response = await me("GET", "/goals?status=ACTIVE&page=1&limit=5");
    const invalid = await me("GET", "/goals?limit=500");

    expect(response.status).toBe(200);
    expect(invalid.status).toBe(400);
  });

  it("answers another user's goal id with 404 and never exposes or changes it", async () => {
    const theirs = await api.prisma.financialGoal.findFirstOrThrow({ where: { userId: userB } });

    const read = await me("GET", `/goals/${theirs.id}`);
    const write = await me("PATCH", `/goals/${theirs.id}`, { name: "Hijacked" });

    expect(read.status).toBe(404);
    expect(read.body).toMatchObject({ message: "Financial goal not found" });
    expect(read.text).not.toContain("B secret goal");
    expect(write.status).toBe(404);
    expect(
      (await api.prisma.financialGoal.findUniqueOrThrow({ where: { id: theirs.id } })).name,
    ).toBe("B secret goal");
  });
});

describe("/api/v1/me/financial-context and /literacy-context", () => {
  it("serve exactly what the internal API serves for the same user (shared logic)", async () => {
    await me("PUT", "/financial-profile", { monthlyIncome: "150000", monthlyExpenses: "100000" });
    await me("POST", "/goals", { type: "SAVINGS", name: "Bicycle", targetAmount: "45000" });
    const internal = { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN };

    const [mine, internalContext, literacy, internalLiteracy] = await Promise.all([
      me<FinancialContextResponse>("GET", "/financial-context"),
      api.request("GET", `/internal/users/${userA}/financial-context`, undefined, internal),
      me<LiteracyContextResponse>("GET", "/literacy-context"),
      api.request("GET", `/internal/users/${userA}/literacy-context`, undefined, internal),
    ]);

    expect(mine.status).toBe(200);
    expect(mine.body).toEqual(internalContext.body);
    expect(mine.body.profile).toMatchObject({ monthlyIncome: "150000.00" });
    expect(literacy.status).toBe(200);
    expect(literacy.body).toEqual(internalLiteracy.body);
  });

  it("User A's context never contains User B's data", async () => {
    const context = await me<FinancialContextResponse>("GET", "/financial-context");

    expect(context.status).toBe(200);
    expect(context.body.profile).toBeNull();
    expect(context.text).not.toContain("987654");
    expect(context.text).not.toContain("B secret goal");
  });

  it("User A cannot reach User B's context through any user-id route", async () => {
    for (const path of [
      `/api/v1/users/${userB}`,
      `/api/v1/users/${userB}/financial-profile`,
      `/api/v1/users/${userB}/goals`,
    ]) {
      const response = await api.request("GET", path, undefined, asA);
      expect(response.status, path).toBe(404);
      expect(response.text).not.toMatch(/987654|B secret goal|Nimal/u);
    }
    // The internal context route is not reachable with a user's access token at all.
    const internal = await api.request(
      "GET",
      `/internal/users/${userB}/financial-context`,
      undefined,
      asA,
    );
    expect(internal.status).toBe(401);
  });

  it("an ADMIN's /me is still only the ADMIN's own data", async () => {
    const context = await me<FinancialContextResponse>(
      "GET",
      "/financial-context",
      undefined,
      await api.authHeaders(userA, "ADMIN"),
    );

    expect(context.body.profile).toBeNull();
    expect(context.text).not.toContain("987654");
  });

  it("answers 404 for a token whose user no longer exists", async () => {
    const response = await me(
      "GET",
      "/financial-context",
      undefined,
      await api.authHeaders(randomUUID()),
    );

    expect(response.status).toBe(404);
  });
});
