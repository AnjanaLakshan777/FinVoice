import type {
  ApiErrorResponse,
  FinancialGoalResponse,
  PaginatedResponse,
  UserResponse,
} from "@finvoice/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startTestApi, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";

const UNKNOWN_ID = "00000000-0000-7000-8000-00000000dead";

let api: TestApi;
let userId: string;
let otherUserId: string;

beforeAll(async () => {
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await truncateAllTables(api.prisma);
  userId = (await createUser("+94000000401")).body.id;
  otherUserId = (await createUser("+94000000402")).body.id;
});

function createUser(phoneNumber: string) {
  return api.request<UserResponse>("POST", "/api/v1/users", {
    phoneNumber,
    preferredLanguage: "SI",
  });
}

function goalsPath(id = userId) {
  return `/api/v1/users/${id}/goals`;
}

function createGoal(body: Record<string, unknown> = {}, id = userId) {
  return api.request<FinancialGoalResponse>("POST", goalsPath(id), {
    type: "SAVINGS",
    name: "Emergency Fund",
    targetAmount: "300000.00",
    ...body,
  });
}

function updateGoal(goalId: string, body: Record<string, unknown>, id = userId) {
  return api.request<FinancialGoalResponse>("PATCH", `${goalsPath(id)}/${goalId}`, body);
}

function listGoals(query = "") {
  return api.request<PaginatedResponse<FinancialGoalResponse>>("GET", `${goalsPath()}${query}`);
}

function fieldsOf(body: unknown): (string | null)[] {
  return (body as ApiErrorResponse).details?.map((detail) => detail.field) ?? [];
}

describe("POST /api/v1/users/:userId/goals", () => {
  it("creates a goal", async () => {
    const response = await createGoal({
      currentAmount: "50000.5",
      targetDate: "2027-06-30",
      currency: "LKR",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String) as unknown,
      userId,
      type: "SAVINGS",
      name: "Emergency Fund",
      targetAmount: "300000.00",
      currentAmount: "50000.50",
      currency: "LKR",
      targetDate: "2027-06-30",
      status: "ACTIVE",
      createdAt: expect.any(String) as unknown,
      updatedAt: expect.any(String) as unknown,
    });

    // The calendar date is stored as the same day, not shifted by time-zone conversion.
    const [row] = await api.prisma.$queryRaw<{ target_date: string }[]>`
      SELECT target_date::text AS target_date FROM financial_goals WHERE id = ${response.body.id}::uuid`;
    expect(row?.target_date).toBe("2027-06-30");
  });

  it("defaults currentAmount to 0, the target date to none and the currency to LKR", async () => {
    const response = await createGoal();

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      currentAmount: "0.00",
      targetDate: null,
      currency: "LKR",
    });
  });

  it.each([
    [{ targetAmount: "-100.00" }, "targetAmount"],
    [{ targetAmount: "0" }, "targetAmount"],
    [{ targetAmount: "0.00" }, "targetAmount"],
    [{ currentAmount: "-0.01" }, "currentAmount"],
    [{ targetAmount: "100.001" }, "targetAmount"],
    [{ targetAmount: 300000 }, "targetAmount"],
    [{ type: "HOLIDAY" }, "type"],
    [{ name: "   " }, "name"],
    [{ name: "x".repeat(121) }, "name"],
    [{ targetDate: "2027-02-30" }, "targetDate"],
    [{ targetDate: "30/06/2027" }, "targetDate"],
    [{ currency: "rs" }, "currency"],
    [{ status: "COMPLETED" }, null],
    [{ id: UNKNOWN_ID }, null],
  ])("rejects %j", async (body, field) => {
    const response = await createGoal(body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fieldsOf(response.body)).toContain(field);
    expect(await api.prisma.financialGoal.count()).toBe(0);
  });

  it("rejects a current amount above the target amount before writing", async () => {
    const response = await createGoal({ targetAmount: "1000.00", currentAmount: "1000.01" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: [{ field: "currentAmount", message: "Must not exceed targetAmount" }],
    });
    expect(await api.prisma.financialGoal.count()).toBe(0);
  });

  it("accepts a current amount equal to the target amount", async () => {
    const response = await createGoal({ targetAmount: "1000", currentAmount: "1000.00" });

    expect(response.status).toBe(201);
  });

  it("returns 404 for a user that does not exist", async () => {
    const response = await createGoal({}, UNKNOWN_ID);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ message: "User not found" });
  });
});

describe("GET /api/v1/users/:userId/goals/:goalId", () => {
  it("returns the goal", async () => {
    const created = await createGoal({ targetDate: "2028-02-29" });

    const response = await api.request("GET", `${goalsPath()}/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(created.body);
  });

  it("returns 404, without revealing it exists, for another user's goal", async () => {
    const othersGoal = await createGoal({}, otherUserId);

    const response = await api.request("GET", `${goalsPath()}/${othersGoal.body.id}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Financial goal not found",
    });
  });

  it("returns 404 when the user does not exist", async () => {
    const goal = await createGoal();

    const response = await api.request("GET", `${goalsPath(UNKNOWN_ID)}/${goal.body.id}`);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ message: "User not found" });
  });

  it("returns 400 for ids that are not UUIDs", async () => {
    const response = await api.request("GET", `/api/v1/users/nope/goals/also-nope`);

    expect(response.status).toBe(400);
    expect(fieldsOf(response.body)).toEqual(["userId", "goalId"]);
  });
});

describe("GET /api/v1/users/:userId/goals", () => {
  it("lists the user's goals, newest first, with pagination metadata", async () => {
    const first = await createGoal({ name: "First" });
    const second = await createGoal({ name: "Second" });
    await createGoal({ name: "Not mine" }, otherUserId);

    const response = await listGoals();

    expect(response.status).toBe(200);
    expect(response.body.data.map((goal) => goal.id)).toEqual([second.body.id, first.body.id]);
    expect(response.body.meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
  });

  it("filters by status", async () => {
    const completed = await createGoal({ name: "Done" });
    await updateGoal(completed.body.id, { status: "COMPLETED" });
    await createGoal({ name: "Still going" });

    const response = await listGoals("?status=COMPLETED");

    expect(response.status).toBe(200);
    expect(response.body.data.map((goal) => goal.name)).toEqual(["Done"]);
    expect(response.body.meta.total).toBe(1);
  });

  it("filters by type, and by type and status together", async () => {
    await createGoal({ type: "DEBT_REPAYMENT", name: "Shop credit" });
    await createGoal({ type: "EMERGENCY_FUND", name: "Rainy day" });

    const byType = await listGoals("?type=DEBT_REPAYMENT");
    const combined = await listGoals("?type=DEBT_REPAYMENT&status=CANCELLED");

    expect(byType.body.data.map((goal) => goal.name)).toEqual(["Shop credit"]);
    expect(combined.body.data).toEqual([]);
    expect(combined.body.meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  it("paginates with page and limit", async () => {
    const names = ["G1", "G2", "G3", "G4", "G5"];
    for (const name of names) {
      await createGoal({ name });
    }

    const page1 = await listGoals("?page=1&limit=2");
    const page3 = await listGoals("?page=3&limit=2");
    const page4 = await listGoals("?page=4&limit=2");

    expect(page1.body.data.map((goal) => goal.name)).toEqual(["G5", "G4"]);
    expect(page1.body.meta).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });
    expect(page3.body.data.map((goal) => goal.name)).toEqual(["G1"]);
    expect(page4.body.data).toEqual([]);
  });

  it.each([
    "?page=0",
    "?limit=0",
    "?limit=101",
    "?page=abc",
    "?status=DONE",
    "?type=CAR",
    "?sort=name",
  ])("rejects the query %s", async (query) => {
    const response = await listGoals(query);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns 404 for a user that does not exist", async () => {
    const response = await api.request("GET", goalsPath(UNKNOWN_ID));

    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/v1/users/:userId/goals/:goalId", () => {
  it("updates the fields sent and leaves the rest unchanged", async () => {
    const created = await createGoal({ currentAmount: "100000", targetDate: "2027-06-30" });

    const response = await updateGoal(created.body.id, {
      name: "  Emergency fund (6 months)  ",
      currentAmount: "125000.25",
      targetDate: null,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: created.body.id,
      name: "Emergency fund (6 months)",
      targetAmount: "300000.00",
      currentAmount: "125000.25",
      targetDate: null,
      status: "ACTIVE",
      createdAt: created.body.createdAt,
    });
    const stored = await api.prisma.financialGoal.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(stored.currentAmount.toFixed(2)).toBe("125000.25");
    expect(stored.targetDate).toBeNull();
  });

  it("changes the status only when asked to", async () => {
    const created = await createGoal({ targetAmount: "1000", currentAmount: "0" });

    const reachedTarget = await updateGoal(created.body.id, { currentAmount: "1000" });
    const completed = await updateGoal(created.body.id, { status: "COMPLETED" });

    expect(reachedTarget.body.status).toBe("ACTIVE");
    expect(completed.body.status).toBe("COMPLETED");
  });

  it.each([
    [
      "lowering the target below the current amount",
      { currentAmount: "100000" },
      { targetAmount: "80000" },
    ],
    ["raising the current amount above the target", {}, { currentAmount: "400000" }],
    [
      "setting both so that current exceeds target",
      {},
      { targetAmount: "500.00", currentAmount: "500.01" },
    ],
  ])("rejects %s and leaves the goal unchanged", async (_case, initial, patch) => {
    const created = await createGoal(initial);

    const response = await updateGoal(created.body.id, patch);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "VALIDATION_ERROR",
      details: [{ field: "currentAmount", message: "Must not exceed targetAmount" }],
    });
    const stored = await api.prisma.financialGoal.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(stored.targetAmount.toFixed(2)).toBe(created.body.targetAmount);
    expect(stored.currentAmount.toFixed(2)).toBe(created.body.currentAmount);
  });

  it.each([
    [{ status: "PAUSED" }, "status"],
    [{ type: "CAR" }, "type"],
    [{ targetAmount: "0" }, "targetAmount"],
    [{ currentAmount: "-5" }, "currentAmount"],
    [{ currentAmount: "1.999" }, "currentAmount"],
    [{ targetDate: "2027-13-01" }, "targetDate"],
    [{ userId: UNKNOWN_ID }, null],
    [{ createdAt: "2020-01-01T00:00:00.000Z" }, null],
    [{}, null],
  ])("rejects %j", async (body, field) => {
    const created = await createGoal();

    const response = await updateGoal(created.body.id, body);

    expect(response.status).toBe(400);
    expect(fieldsOf(response.body)).toContain(field);
  });

  it("returns 404 for another user's goal and does not modify it", async () => {
    const othersGoal = await createGoal({ name: "Theirs" }, otherUserId);

    const response = await updateGoal(othersGoal.body.id, { name: "Hijacked" });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ message: "Financial goal not found" });
    const stored = await api.prisma.financialGoal.findUniqueOrThrow({
      where: { id: othersGoal.body.id },
    });
    expect(stored.name).toBe("Theirs");
  });
});
