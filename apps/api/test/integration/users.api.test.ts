import type { ApiErrorResponse, UserResponse } from "@finvoice/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startTestApi, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";

// Fake phone numbers: "+94" followed by 0 is never assigned in Sri Lanka's numbering plan.
const PHONE_A = "+94000000201";
const PHONE_B = "+94000000202";
const UNKNOWN_ID = "00000000-0000-7000-8000-00000000dead";
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

function createUser(body: Record<string, unknown> = {}) {
  return api.request<UserResponse>("POST", "/api/v1/users", {
    phoneNumber: PHONE_A,
    preferredLanguage: "SI",
    ...body,
  });
}

function fieldsOf(body: unknown): (string | null)[] {
  return (body as ApiErrorResponse).details?.map((detail) => detail.field) ?? [];
}

describe("POST /api/v1/users", () => {
  it("creates a user with database-generated id and defaults", async () => {
    const response = await createUser({ displayName: "  Kamal  " });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.stringMatching(UUID_V7) as unknown,
      phoneNumber: PHONE_A,
      displayName: "Kamal",
      preferredLanguage: "SI",
      timezone: "Asia/Colombo",
      status: "ACTIVE",
      createdAt: expect.any(String) as unknown,
      updatedAt: expect.any(String) as unknown,
    });
    expect(new Date(response.body.createdAt).toISOString()).toBe(response.body.createdAt);

    const stored = await api.prisma.user.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(stored).toMatchObject({ phoneNumber: PHONE_A, displayName: "Kamal", status: "ACTIVE" });
  });

  it("stores a blank display name as null", async () => {
    const response = await createUser({ displayName: "   " });

    expect(response.status).toBe(201);
    expect(response.body.displayName).toBeNull();
  });

  it.each([
    "0771234567",
    "94771234567",
    "+94 77 123 4567",
    "+1234567",
    "+1234567890123456",
    94771234567,
  ])("rejects the malformed phone number %j", async (phoneNumber) => {
    const response = await createUser({ phoneNumber });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
    expect(fieldsOf(response.body)).toContain("phoneNumber");
    expect(await api.prisma.user.count()).toBe(0);
  });

  it("rejects an invalid preferred language", async () => {
    const response = await createUser({ preferredLanguage: "FR" });

    expect(response.status).toBe(400);
    expect(fieldsOf(response.body)).toContain("preferredLanguage");
  });

  it("reports every missing required field", async () => {
    const response = await api.request("POST", "/api/v1/users", {});

    expect(response.status).toBe(400);
    expect(fieldsOf(response.body)).toEqual(
      expect.arrayContaining(["phoneNumber", "preferredLanguage"]),
    );
  });

  it("rejects properties outside the contract instead of ignoring them", async () => {
    for (const extra of [
      { isAdmin: true },
      { password: "hunter2" },
      { id: UNKNOWN_ID },
      { status: "INACTIVE" },
      { createdAt: "2020-01-01T00:00:00.000Z" },
    ]) {
      const response = await createUser(extra);

      expect(response.status, JSON.stringify(extra)).toBe(400);
      expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect(await api.prisma.user.count()).toBe(0);
  });

  it("rejects a duplicate phone number with 409", async () => {
    expect((await createUser()).status).toBe(201);

    const response = await createUser({ preferredLanguage: "EN" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      statusCode: 409,
      code: "CONFLICT",
      message: "A user with this phone number already exists",
      details: [{ field: "phoneNumber", message: "Already registered to another user" }],
    });
    expect(await api.prisma.user.count()).toBe(1);
  });
});

describe("GET /api/v1/users/:userId", () => {
  it("returns the user", async () => {
    const created = await createUser({ displayName: "Kamal" });

    const response = await api.request<UserResponse>("GET", `/api/v1/users/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(created.body);
  });

  it("returns 404 for an unknown user", async () => {
    const response = await api.request("GET", `/api/v1/users/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "User not found",
    });
  });

  it("returns 400 for an id that is not a UUID", async () => {
    const response = await api.request("GET", "/api/v1/users/not-a-uuid");

    expect(response.status).toBe(400);
    expect(fieldsOf(response.body)).toEqual(["userId"]);
  });
});

describe("PATCH /api/v1/users/:userId", () => {
  it("updates only the fields sent", async () => {
    const created = await createUser({ displayName: "Kamal" });

    const response = await api.request<UserResponse>("PATCH", `/api/v1/users/${created.body.id}`, {
      preferredLanguage: "TA",
      status: "INACTIVE",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: created.body.id,
      phoneNumber: PHONE_A,
      displayName: "Kamal",
      preferredLanguage: "TA",
      status: "INACTIVE",
      createdAt: created.body.createdAt,
    });
    expect(Date.parse(response.body.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(created.body.updatedAt),
    );
    const stored = await api.prisma.user.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored).toMatchObject({ preferredLanguage: "TA", status: "INACTIVE" });
  });

  it("changes the phone number and clears the display name with null", async () => {
    const created = await createUser({ displayName: "Kamal" });

    const response = await api.request<UserResponse>("PATCH", `/api/v1/users/${created.body.id}`, {
      phoneNumber: PHONE_B,
      displayName: null,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ phoneNumber: PHONE_B, displayName: null });
  });

  it("rejects a phone number that belongs to another user with 409", async () => {
    await createUser();
    const other = await createUser({ phoneNumber: PHONE_B });

    const response = await api.request("PATCH", `/api/v1/users/${other.body.id}`, {
      phoneNumber: PHONE_A,
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "CONFLICT" });
    const stored = await api.prisma.user.findUniqueOrThrow({ where: { id: other.body.id } });
    expect(stored.phoneNumber).toBe(PHONE_B);
  });

  it.each([
    [{ preferredLanguage: "si" }, "preferredLanguage"],
    [{ status: "DELETED" }, "status"],
    [{ phoneNumber: "12345" }, "phoneNumber"],
    [{ displayName: "x".repeat(101) }, "displayName"],
  ])("rejects the invalid value %j", async (body, field) => {
    const created = await createUser();

    const response = await api.request("PATCH", `/api/v1/users/${created.body.id}`, body);

    expect(response.status).toBe(400);
    expect(fieldsOf(response.body)).toContain(field);
  });

  it.each([{ id: UNKNOWN_ID }, { createdAt: "2020-01-01T00:00:00.000Z" }, { updatedAt: "x" }, {}])(
    "rejects %j",
    async (body) => {
      const created = await createUser();

      const response = await api.request("PATCH", `/api/v1/users/${created.body.id}`, body);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
    },
  );

  it("returns 404 for an unknown user", async () => {
    const response = await api.request("PATCH", `/api/v1/users/${UNKNOWN_ID}`, {
      preferredLanguage: "EN",
    });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: "NOT_FOUND", message: "User not found" });
  });
});
