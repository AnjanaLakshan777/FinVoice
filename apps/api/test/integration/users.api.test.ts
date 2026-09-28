import { randomUUID } from "node:crypto";

import type { ApiErrorResponse, UserResponse } from "@finvoice/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startTestApi, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";

// Fake phone numbers: "+94" followed by 0 is never assigned in Sri Lanka's numbering plan.
const PHONE_A = "+94000000201";
const PHONE_B = "+94000000202";
const UNKNOWN_ID = "00000000-0000-7000-8000-00000000dead";
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const USER_NOT_FOUND = { statusCode: 404, code: "NOT_FOUND", message: "User not found" };
const UNAUTHENTICATED = {
  statusCode: 401,
  code: "UNAUTHORIZED",
  message: "Missing or invalid access token",
};

let api: TestApi;
/** An administrator's token. The role is read from the (validly signed) token only. */
let admin: Record<string, string>;

beforeAll(async () => {
  api = await startTestApi();
  admin = await api.authHeaders(randomUUID(), "ADMIN");
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await truncateAllTables(api.prisma);
});

function createUser(body: Record<string, unknown> = {}, headers = admin) {
  return api.request<UserResponse>(
    "POST",
    "/api/v1/users",
    { phoneNumber: PHONE_A, preferredLanguage: "SI", ...body },
    headers,
  );
}

/** Creates a user and returns it with that user's own Authorization header. */
async function createSignedInUser(body: Record<string, unknown> = {}) {
  const created = await createUser(body);
  expect(created.status).toBe(201);
  return { user: created.body, headers: await api.authHeaders(created.body.id) };
}

function fieldsOf(body: unknown): (string | null)[] {
  return (body as ApiErrorResponse).details?.map((detail) => detail.field) ?? [];
}

describe("POST /api/v1/users (ADMIN-only provisioning)", () => {
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
    expect(stored).toMatchObject({
      phoneNumber: PHONE_A,
      displayName: "Kamal",
      status: "ACTIVE",
      role: "USER",
    });
  });

  it("is not a public registration endpoint: 401 without a token", async () => {
    const response = await createUser({}, {});

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
    expect(await api.prisma.user.count()).toBe(0);
  });

  it("answers 403 to a signed-in USER", async () => {
    const response = await createUser({}, await api.authHeaders(randomUUID(), "USER"));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      statusCode: 403,
      code: "FORBIDDEN",
      message: "You do not have permission to perform this action",
    });
    expect(await api.prisma.user.count()).toBe(0);
  });

  it("never lets the request choose a role, even for an ADMIN", async () => {
    const response = await createUser({ role: "ADMIN" });

    // Rejected as an unknown key (strict contract), not ignored.
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(response.text).toContain("role");
    expect(await api.prisma.user.count()).toBe(0);
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
    const response = await api.request("POST", "/api/v1/users", {}, admin);

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
      { role: "USER" },
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
  it("returns the caller's own user", async () => {
    const { user, headers } = await createSignedInUser({ displayName: "Kamal" });

    const response = await api.request<UserResponse>(
      "GET",
      `/api/v1/users/${user.id}`,
      undefined,
      headers,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(user);
  });

  it("accepts the caller's own id in upper case (UUIDs are case-insensitive)", async () => {
    const { user, headers } = await createSignedInUser();

    const response = await api.request(
      "GET",
      `/api/v1/users/${user.id.toUpperCase()}`,
      undefined,
      headers,
    );

    expect(response.status).toBe(200);
  });

  it("answers another user's id exactly like an unknown id (404), without revealing it exists", async () => {
    const { headers } = await createSignedInUser();
    const other = await createUser({ phoneNumber: PHONE_B });

    const otherUser = await api.request(
      "GET",
      `/api/v1/users/${other.body.id}`,
      undefined,
      headers,
    );
    const unknown = await api.request("GET", `/api/v1/users/${UNKNOWN_ID}`, undefined, headers);

    expect(otherUser.status).toBe(404);
    expect(otherUser.body).toEqual(USER_NOT_FOUND);
    expect(unknown.body).toEqual(USER_NOT_FOUND);
    expect(otherUser.text).not.toContain(PHONE_B);
  });

  it("gives an ADMIN no access to other users' records", async () => {
    const created = await createUser();

    const response = await api.request("GET", `/api/v1/users/${created.body.id}`, undefined, admin);

    expect(response.status).toBe(404);
  });

  it("returns 404 when the token's user no longer exists", async () => {
    const response = await api.request(
      "GET",
      `/api/v1/users/${UNKNOWN_ID}`,
      undefined,
      await api.authHeaders(UNKNOWN_ID),
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual(USER_NOT_FOUND);
  });

  it("returns 400 for an id that is not a UUID", async () => {
    const { headers } = await createSignedInUser();

    const response = await api.request("GET", "/api/v1/users/not-a-uuid", undefined, headers);

    expect(response.status).toBe(400);
    expect(fieldsOf(response.body)).toEqual(["userId"]);
  });

  it("requires authentication before anything else (401, even for a malformed id)", async () => {
    for (const path of [`/api/v1/users/${UNKNOWN_ID}`, "/api/v1/users/not-a-uuid"]) {
      const response = await api.request("GET", path);

      expect(response.status).toBe(401);
      expect(response.body).toEqual(UNAUTHENTICATED);
    }
  });
});

describe("PATCH /api/v1/users/:userId", () => {
  it("updates only the fields sent", async () => {
    const { user, headers } = await createSignedInUser({ displayName: "Kamal" });

    const response = await api.request<UserResponse>(
      "PATCH",
      `/api/v1/users/${user.id}`,
      { preferredLanguage: "TA" },
      headers,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: user.id,
      phoneNumber: PHONE_A,
      displayName: "Kamal",
      preferredLanguage: "TA",
      status: "ACTIVE",
      createdAt: user.createdAt,
    });
    expect(Date.parse(response.body.updatedAt)).toBeGreaterThanOrEqual(Date.parse(user.updatedAt));
    const stored = await api.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored).toMatchObject({ preferredLanguage: "TA", status: "ACTIVE", role: "USER" });
  });

  it("clears the display name with null", async () => {
    const { user, headers } = await createSignedInUser({ displayName: "Kamal" });

    const response = await api.request<UserResponse>(
      "PATCH",
      `/api/v1/users/${user.id}`,
      { displayName: null },
      headers,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ displayName: null });
  });

  it.each([
    { body: { phoneNumber: PHONE_B }, what: "the login phone number" },
    { body: { status: "INACTIVE" }, what: "the account status" },
    { body: { role: "ADMIN" }, what: "the role" },
  ])("rejects $body: a user cannot change $what", async ({ body }) => {
    const { user, headers } = await createSignedInUser();

    const response = await api.request("PATCH", `/api/v1/users/${user.id}`, body, headers);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
    const stored = await api.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored).toMatchObject({ phoneNumber: PHONE_A, status: "ACTIVE", role: "USER" });
  });

  it.each([
    [{ preferredLanguage: "si" }, "preferredLanguage"],
    [{ displayName: "x".repeat(101) }, "displayName"],
  ])("rejects the invalid value %j", async (body, field) => {
    const { user, headers } = await createSignedInUser();

    const response = await api.request("PATCH", `/api/v1/users/${user.id}`, body, headers);

    expect(response.status).toBe(400);
    expect(fieldsOf(response.body)).toContain(field);
  });

  it.each([{ id: UNKNOWN_ID }, { createdAt: "2020-01-01T00:00:00.000Z" }, { updatedAt: "x" }, {}])(
    "rejects %j",
    async (body) => {
      const { user, headers } = await createSignedInUser();

      const response = await api.request("PATCH", `/api/v1/users/${user.id}`, body, headers);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
    },
  );

  it("cannot change another user (404) and leaves them unchanged", async () => {
    const { headers } = await createSignedInUser();
    const other = await createUser({ phoneNumber: PHONE_B, displayName: "Nimal" });

    const response = await api.request(
      "PATCH",
      `/api/v1/users/${other.body.id}`,
      { displayName: "Changed" },
      headers,
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual(USER_NOT_FOUND);
    const stored = await api.prisma.user.findUniqueOrThrow({ where: { id: other.body.id } });
    expect(stored.displayName).toBe("Nimal");
  });

  it("returns 404 when the token's user no longer exists", async () => {
    const response = await api.request(
      "PATCH",
      `/api/v1/users/${UNKNOWN_ID}`,
      { preferredLanguage: "EN" },
      await api.authHeaders(UNKNOWN_ID),
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual(USER_NOT_FOUND);
  });

  it("requires authentication (401)", async () => {
    const response = await api.request("PATCH", `/api/v1/users/${UNKNOWN_ID}`, {
      preferredLanguage: "EN",
    });

    expect(response.status).toBe(401);
  });
});
