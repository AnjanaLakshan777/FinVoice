import { randomUUID } from "node:crypto";

import {
  INTERNAL_TOKEN_HEADER,
  type ApiErrorResponse,
  type FinancialContextResponse,
  type LiteracyContextResponse,
  type LiteracyProfileResponse,
  type LiteracyTopicProgressResponse,
} from "@finvoice/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { startTestApi, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";

/** Test-only token; never a real secret. */
const TOKEN = "internal-test-token-for-user-context-0123456789";
const AUTH = { [INTERNAL_TOKEN_HEADER]: TOKEN };
// Fake phone numbers: "+94" followed by 0 is never assigned in Sri Lanka's numbering plan.
const PHONE = "+94000000901";

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi({ internalToken: TOKEN });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await truncateAllTables(api.prisma);
});

const contextPath = (userId: string) => `/internal/users/${userId}/financial-context`;
const literacyPath = (userId: string) => `/internal/users/${userId}/literacy-context`;
const topicPath = (userId: string, topic: string, action: "start" | "complete") =>
  `/internal/users/${userId}/literacy/topics/${topic}/${action}`;
const profilePath = (userId: string) => `/internal/users/${userId}/literacy/profile`;

function getContext(userId: string, headers: Record<string, string> = AUTH) {
  return api.request<FinancialContextResponse>("GET", contextPath(userId), undefined, headers);
}

async function createUser(overrides: { preferredLanguage?: "SI" | "TA" | "EN" } = {}) {
  return api.prisma.user.create({
    data: { phoneNumber: PHONE, preferredLanguage: overrides.preferredLanguage ?? "SI" },
  });
}

describe("internal user-context API: access", () => {
  it.each([
    ["no token", {}],
    ["a wrong token", { [INTERNAL_TOKEN_HEADER]: "wrong-token-wrong-token-wrong-token-000" }],
    ["an empty token", { [INTERNAL_TOKEN_HEADER]: "" }],
    ["a Bearer-prefixed token", { [INTERNAL_TOKEN_HEADER]: `Bearer ${TOKEN}` }],
    ["a truncated token", { [INTERNAL_TOKEN_HEADER]: TOKEN.slice(0, -1) }],
    ["the token with a suffix", { [INTERNAL_TOKEN_HEADER]: `${TOKEN}x` }],
    ["the token in the Authorization header", { authorization: `Bearer ${TOKEN}` }],
  ])("rejects %s with 401 on every route", async (_case, headers) => {
    const user = await createUser();
    const responses = await Promise.all([
      api.request<ApiErrorResponse>("GET", contextPath(user.id), undefined, headers),
      api.request<ApiErrorResponse>("GET", literacyPath(user.id), undefined, headers),
      api.request<ApiErrorResponse>("POST", topicPath(user.id, "SAVING", "start"), {}, headers),
      api.request<ApiErrorResponse>("POST", topicPath(user.id, "SAVING", "complete"), {}, headers),
      api.request<ApiErrorResponse>(
        "PUT",
        profilePath(user.id),
        { level: "CONFIDENT", assessmentVersion: "1", assessedAt: null },
        headers,
      ),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        statusCode: 401,
        code: "UNAUTHORIZED",
        message: "Missing or invalid internal token",
      });
      expect(response.text).not.toContain(TOKEN);
      expect(response.text).not.toContain(user.id);
    }
    // Nothing was written.
    expect(await api.prisma.financialLiteracyTopicProgress.count()).toBe(0);
    expect(await api.prisma.financialLiteracyProfile.count()).toBe(0);
  });

  it("answers 401, not 404, for a random user id without the token (existence is not revealed)", async () => {
    const response = await getContext(randomUUID(), {});
    expect(response.status).toBe(401);
  });

  it("answers 404 for an unknown user with the token", async () => {
    const response = await getContext(randomUUID());
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "User not found",
    });
  });

  it("rejects a malformed user id with 400 (with the token) and 401 (without)", async () => {
    expect((await getContext("not-a-uuid")).status).toBe(400);
    expect((await getContext("not-a-uuid", {})).status).toBe(401);
  });

  it("is not part of the public /api/v1 API", async () => {
    const user = await createUser();
    const response = await api.request("GET", `/api/v1${contextPath(user.id)}`, undefined, AUTH);
    expect(response.status).toBe(404);
  });

  it("answers 503 when the API has no internal token configured", async () => {
    const unconfigured = await startTestApi();
    try {
      const response = await unconfigured.request(
        "GET",
        contextPath(randomUUID()),
        undefined,
        AUTH,
      );
      expect(response.status).toBe(503);
    } finally {
      await unconfigured.close();
    }
  });

  it("never writes the token to the console", async () => {
    const writes: string[] = [];
    const capture = (chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    };
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(capture);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(capture);
    try {
      await getContext(randomUUID(), { [INTERNAL_TOKEN_HEADER]: `${TOKEN}-wrong` });
      await getContext(randomUUID());
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
    expect(writes.join("")).not.toContain(TOKEN);
  });
});

describe("GET /internal/users/:userId/financial-context", () => {
  it("returns the complete minimised context", async () => {
    const user = await createUser({ preferredLanguage: "SI" });
    await api.prisma.financialProfile.create({
      data: { userId: user.id, monthlyIncome: "150000.00", monthlyExpenses: "100000.00" },
    });
    await api.prisma.financialGoal.create({
      data: {
        userId: user.id,
        type: "EMERGENCY_FUND",
        name: "Emergency Fund",
        targetAmount: "300000.00",
        currentAmount: "50000.00",
        targetDate: new Date("2027-06-30"),
      },
    });

    const response = await getContext(user.id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: { preferredLanguage: "SI", timezone: "Asia/Colombo" },
      profile: { monthlyIncome: "150000.00", monthlyExpenses: "100000.00", currency: "LKR" },
      goals: [
        {
          type: "EMERGENCY_FUND",
          name: "Emergency Fund",
          targetAmount: "300000.00",
          currentAmount: "50000.00",
          targetDate: "2027-06-30",
          currency: "LKR",
          status: "ACTIVE",
        },
      ],
      moreActiveGoals: false,
      literacy: { level: "BEGINNER", assessmentVersion: "1", assessedAt: null, topics: [] },
      completeness: { profileComplete: true, missingFields: [] },
    });
  });

  it("contains no ids, phone number, display name, record timestamps or secrets", async () => {
    const user = await api.prisma.user.create({
      data: { phoneNumber: PHONE, preferredLanguage: "EN", displayName: "Private Name" },
    });
    const profile = await api.prisma.financialProfile.create({
      data: { userId: user.id, monthlyIncome: "1.00" },
    });
    const goal = await api.prisma.financialGoal.create({
      data: { userId: user.id, type: "SAVINGS", name: "Bike", targetAmount: "10.00" },
    });
    const literacy = await api.prisma.financialLiteracyProfile.create({
      data: { userId: user.id },
    });
    await api.request("POST", topicPath(user.id, "SAVING", "start"), {}, AUTH);

    const { text } = await getContext(user.id);

    for (const secret of [
      user.id,
      profile.id,
      goal.id,
      literacy.id,
      PHONE,
      "Private Name",
      TOKEN,
    ]) {
      expect(text).not.toContain(secret);
    }
    for (const key of ["id", "userId", "phoneNumber", "displayName", "createdAt", "updatedAt"]) {
      expect(text).not.toContain(`"${key}"`);
    }
  });

  it("returns a partial context for a user with no financial profile, goals or literacy data", async () => {
    const user = await createUser({ preferredLanguage: "TA" });

    const response = await getContext(user.id);

    expect(response.body).toEqual({
      user: { preferredLanguage: "TA", timezone: "Asia/Colombo" },
      profile: null,
      goals: [],
      moreActiveGoals: false,
      literacy: { level: "BEGINNER", assessmentVersion: "1", assessedAt: null, topics: [] },
      completeness: {
        profileComplete: false,
        missingFields: ["monthlyIncome", "monthlyExpenses", "activeGoal"],
      },
    });
    // Reading the context never creates rows.
    expect(await api.prisma.financialLiteracyProfile.count()).toBe(0);
  });

  it("distinguishes a missing amount (null) from zero", async () => {
    const user = await createUser();
    await api.prisma.financialProfile.create({
      data: { userId: user.id, monthlyIncome: "0.00", monthlyExpenses: null },
    });

    const { body } = await getContext(user.id);

    expect(body.profile).toEqual({ monthlyIncome: "0.00", monthlyExpenses: null, currency: "LKR" });
    expect(body.completeness.missingFields).toEqual(["monthlyExpenses", "activeGoal"]);
  });

  it("includes only ACTIVE goals, soonest target date first", async () => {
    const user = await createUser();
    const goal = (
      name: string,
      status: "ACTIVE" | "COMPLETED" | "CANCELLED",
      targetDate: string | null,
    ) =>
      api.prisma.financialGoal.create({
        data: {
          userId: user.id,
          type: "SAVINGS",
          name,
          targetAmount: "1000.00",
          status,
          targetDate: targetDate === null ? null : new Date(targetDate),
        },
      });
    await goal("No date", "ACTIVE", null);
    await goal("Later", "ACTIVE", "2028-01-01");
    await goal("Done", "COMPLETED", "2026-01-01");
    await goal("Dropped", "CANCELLED", "2026-02-01");
    await goal("Sooner", "ACTIVE", "2027-01-01");

    const { body } = await getContext(user.id);

    expect(body.goals.map((g) => g.name)).toEqual(["Sooner", "Later", "No date"]);
    expect(body.goals.every((g) => g.status === "ACTIVE")).toBe(true);
    expect(body.moreActiveGoals).toBe(false);
  });

  it("caps active goals at 20 and says that more exist", async () => {
    const user = await createUser();
    await api.prisma.financialGoal.createMany({
      data: Array.from({ length: 21 }, (_, i) => ({
        userId: user.id,
        type: "SAVINGS" as const,
        name: `Goal ${String(i)}`,
        targetAmount: "100.00",
      })),
    });

    const { body } = await getContext(user.id);

    expect(body.goals).toHaveLength(20);
    expect(body.moreActiveGoals).toBe(true);
  });

  it("keeps money as exact decimal strings", async () => {
    const user = await createUser();
    await api.prisma.financialProfile.create({
      data: { userId: user.id, monthlyIncome: "999999999999.99", monthlyExpenses: "0.10" },
    });
    await api.prisma.financialGoal.create({
      data: {
        userId: user.id,
        type: "OTHER",
        name: "Big",
        targetAmount: "123456789.05",
        currentAmount: "0.01",
      },
    });

    const { body, text } = await getContext(user.id);

    expect(body.profile?.monthlyIncome).toBe("999999999999.99");
    expect(body.profile?.monthlyExpenses).toBe("0.10");
    expect(body.goals[0]).toMatchObject({ targetAmount: "123456789.05", currentAmount: "0.01" });
    expect(text).not.toMatch(/"monthlyIncome":\d/);
  });

  it("includes recorded literacy progress and level", async () => {
    const user = await createUser();
    await api.request(
      "PUT",
      profilePath(user.id),
      { level: "DEVELOPING", assessmentVersion: "1", assessedAt: "2026-09-01T10:00:00.000Z" },
      AUTH,
    );
    await api.request("POST", topicPath(user.id, "SCAMS", "complete"), {}, AUTH);
    await api.request("POST", topicPath(user.id, "SAVING", "start"), {}, AUTH);

    const { body } = await getContext(user.id);

    expect(body.literacy).toMatchObject({
      level: "DEVELOPING",
      assessmentVersion: "1",
      assessedAt: "2026-09-01T10:00:00.000Z",
    });
    expect(body.literacy.topics.map(({ topic, status }) => ({ topic, status }))).toEqual([
      { topic: "SAVING", status: "IN_PROGRESS" },
      { topic: "SCAMS", status: "COMPLETED" },
    ]);
    expect(Object.keys(body.literacy.topics[0] ?? {}).sort()).toEqual(
      ["lastActivityAt", "status", "topic"].sort(),
    );
  });
});

describe("literacy writes", () => {
  it("starts a topic with server-set timestamps, ignoring any client-sent values", async () => {
    const user = await createUser();
    const before = Date.now();

    const response = await api.request<LiteracyTopicProgressResponse>(
      "POST",
      topicPath(user.id, "BUDGETING", "start"),
      { startedAt: "2000-01-01T00:00:00.000Z", status: "COMPLETED" },
      AUTH,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      topic: "BUDGETING",
      status: "IN_PROGRESS",
      completedAt: null,
    });
    expect(Date.parse(response.body.startedAt ?? "")).toBeGreaterThanOrEqual(before - 1000);
    expect(response.body.lastActivityAt).toBe(response.body.startedAt);
  });

  it("records activity when an in-progress topic is started again, keeping the start time", async () => {
    const user = await createUser();
    const first = await api.request<LiteracyTopicProgressResponse>(
      "POST",
      topicPath(user.id, "SAVING", "start"),
      {},
      AUTH,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await api.request<LiteracyTopicProgressResponse>(
      "POST",
      topicPath(user.id, "SAVING", "start"),
      {},
      AUTH,
    );

    expect(second.body.startedAt).toBe(first.body.startedAt);
    expect(Date.parse(second.body.lastActivityAt ?? "")).toBeGreaterThan(
      Date.parse(first.body.startedAt ?? ""),
    );
    expect(await api.prisma.financialLiteracyTopicProgress.count()).toBe(1);
  });

  it("completes an in-progress topic (completedAt not before startedAt)", async () => {
    const user = await createUser();
    await api.request("POST", topicPath(user.id, "SAVING", "start"), {}, AUTH);

    const response = await api.request<LiteracyTopicProgressResponse>(
      "POST",
      topicPath(user.id, "SAVING", "complete"),
      {},
      AUTH,
    );

    expect(response.body.status).toBe("COMPLETED");
    expect(Date.parse(response.body.completedAt ?? "")).toBeGreaterThanOrEqual(
      Date.parse(response.body.startedAt ?? ""),
    );
  });

  it("completes a topic that was never started", async () => {
    const user = await createUser();
    const response = await api.request<LiteracyTopicProgressResponse>(
      "POST",
      topicPath(user.id, "DEPOSIT_PROTECTION", "complete"),
      {},
      AUTH,
    );

    expect(response.body.status).toBe("COMPLETED");
    expect(response.body.startedAt).toBe(response.body.completedAt);
  });

  it("returns a completed topic unchanged when completed again", async () => {
    const user = await createUser();
    const first = await api.request<LiteracyTopicProgressResponse>(
      "POST",
      topicPath(user.id, "SCAMS", "complete"),
      {},
      AUTH,
    );
    const second = await api.request<LiteracyTopicProgressResponse>(
      "POST",
      topicPath(user.id, "SCAMS", "complete"),
      {},
      AUTH,
    );

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("never moves a completed topic back (start after complete is 409)", async () => {
    const user = await createUser();
    await api.request("POST", topicPath(user.id, "SCAMS", "complete"), {}, AUTH);

    const response = await api.request<ApiErrorResponse>(
      "POST",
      topicPath(user.id, "SCAMS", "start"),
      {},
      AUTH,
    );

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "CONFLICT",
      message: "This topic is already completed",
    });
    const row = await api.prisma.financialLiteracyTopicProgress.findFirstOrThrow();
    expect(row.status).toBe("COMPLETED");
  });

  it.each(["CRYPTO", "saving", "INVESTING"])("rejects the topic %s", async (topic) => {
    const user = await createUser();
    const response = await api.request<ApiErrorResponse>(
      "POST",
      topicPath(user.id, topic, "start"),
      {},
      AUTH,
    );
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for progress of an unknown user", async () => {
    const response = await api.request(
      "POST",
      topicPath(randomUUID(), "SAVING", "start"),
      {},
      AUTH,
    );
    expect(response.status).toBe(404);
  });

  it("returns the literacy context with start and completion times", async () => {
    const user = await createUser();
    await api.request("POST", topicPath(user.id, "SAVING", "start"), {}, AUTH);

    const response = await api.request<LiteracyContextResponse>(
      "GET",
      literacyPath(user.id),
      undefined,
      AUTH,
    );

    expect(response.body).toMatchObject({
      level: "BEGINNER",
      assessmentVersion: "1",
      assessedAt: null,
      topics: [{ topic: "SAVING", status: "IN_PROGRESS", completedAt: null }],
    });
    expect(response.text).not.toContain(user.id);
  });

  it("updates the level explicitly", async () => {
    const user = await createUser();
    const response = await api.request<LiteracyProfileResponse>(
      "PUT",
      profilePath(user.id),
      { level: "CONFIDENT", assessmentVersion: "2026.1", assessedAt: "2026-09-20T08:30:00+05:30" },
      AUTH,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      level: "CONFIDENT",
      assessmentVersion: "2026.1",
      assessedAt: "2026-09-20T03:00:00.000Z",
    });
  });

  it.each([
    [
      "a future assessment time",
      { level: "CONFIDENT", assessmentVersion: "1", assessedAt: "2999-01-01T00:00:00Z" },
    ],
    ["an unknown level", { level: "EXPERT", assessmentVersion: "1", assessedAt: null }],
    ["a numeric score", { level: "BEGINNER", assessmentVersion: "1", assessedAt: null, score: 42 }],
    ["a missing assessment version", { level: "BEGINNER", assessedAt: null }],
    ["a missing assessedAt", { level: "BEGINNER", assessmentVersion: "1" }],
    [
      "a date without an offset",
      { level: "BEGINNER", assessmentVersion: "1", assessedAt: "2026-01-01T00:00:00" },
    ],
  ])("rejects a level update with %s", async (_case, body) => {
    const user = await createUser();
    const response = await api.request<ApiErrorResponse>("PUT", profilePath(user.id), body, AUTH);
    expect(response.status).toBe(400);
    expect(await api.prisma.financialLiteracyProfile.count()).toBe(0);
  });
});

describe("privacy boundary (IDOR regressions)", () => {
  it("the public agent endpoint rejects a userId instead of reading that user's data", async () => {
    const user = await createUser();
    await api.prisma.financialProfile.create({
      data: { userId: user.id, monthlyIncome: "150000.00" },
    });

    const response = await api.request<ApiErrorResponse>("POST", "/api/v1/agent/chat", {
      message: "What is my income?",
      userId: user.id,
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(response.text).not.toContain("150000");
  });

  it("no public route serves personal context", async () => {
    const user = await createUser();
    for (const path of [
      `/api/v1/users/${user.id}/financial-context`,
      `/api/v1/users/${user.id}/literacy-context`,
      `/api/v1/internal/users/${user.id}/financial-context`,
    ]) {
      expect((await api.request("GET", path)).status).toBe(404);
    }
  });
});
