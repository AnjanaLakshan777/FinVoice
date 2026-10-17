import { randomUUID } from "node:crypto";

import type { ApiErrorResponse, Language, UserResponse } from "@finvoice/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startTestApi, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";

const UNKNOWN_ID = "00000000-0000-7000-8000-00000000dead";
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

/** A user created directly in the database (accounts are created only by POST /auth/guest). */
async function createUser(
  data: { displayName?: string | null; preferredLanguage?: Language } = {},
) {
  const user = await api.prisma.user.create({ data: { preferredLanguage: "SI", ...data } });
  const body: UserResponse = {
    id: user.id,
    displayName: user.displayName,
    preferredLanguage: user.preferredLanguage,
    timezone: user.timezone,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
  return { body };
}

/** Creates a user and returns it with that user's own Authorization header. */
async function createSignedInUser(data: Parameters<typeof createUser>[0] = {}) {
  const created = await createUser(data);
  return { user: created.body, headers: await api.authHeaders(created.body.id) };
}

function fieldsOf(body: unknown): (string | null)[] {
  return (body as ApiErrorResponse).details?.map((detail) => detail.field) ?? [];
}

describe("POST /api/v1/users", () => {
  it("does not exist: accounts are created only by POST /api/v1/auth/guest", async () => {
    const response = await api.request("POST", "/api/v1/users", { preferredLanguage: "SI" }, admin);

    expect(response.status).toBe(404);
    expect(await api.prisma.user.count()).toBe(0);
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
    const other = await createUser({ displayName: "Nimal" });

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
    expect(otherUser.text).not.toContain("Nimal");
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
    { body: { phoneNumber: "+94000000202" }, what: "a phone number" },
    { body: { status: "INACTIVE" }, what: "the account status" },
    { body: { role: "ADMIN" }, what: "the role" },
  ])("rejects $body: a user cannot change $what", async ({ body }) => {
    const { user, headers } = await createSignedInUser();

    const response = await api.request("PATCH", `/api/v1/users/${user.id}`, body, headers);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
    const stored = await api.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored).toMatchObject({ status: "ACTIVE", role: "USER" });
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
    const other = await createUser({ displayName: "Nimal" });

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
