import type { ApiErrorResponse, FinancialProfileResponse } from "@finvoice/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startTestApi, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";

const UNKNOWN_ID = "00000000-0000-7000-8000-00000000dead";

let api: TestApi;
let userId: string;
/** The signed-in user's own Authorization header. */
let headers: Record<string, string>;

beforeAll(async () => {
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await truncateAllTables(api.prisma);
  const user = await api.prisma.user.create({
    data: { phoneNumber: "+94000000301", preferredLanguage: "EN" },
  });
  userId = user.id;
  headers = await api.authHeaders(userId);
});

function putProfile(body: Record<string, unknown>, id = userId, auth = headers) {
  return api.request<FinancialProfileResponse>(
    "PUT",
    `/api/v1/users/${id}/financial-profile`,
    body,
    auth,
  );
}

function getProfile(id = userId, auth = headers) {
  return api.request("GET", `/api/v1/users/${id}/financial-profile`, undefined, auth);
}

function fieldsOf(body: unknown): (string | null)[] {
  return (body as ApiErrorResponse).details?.map((detail) => detail.field) ?? [];
}

describe("PUT /api/v1/users/:userId/financial-profile", () => {
  it("creates the profile, returning money as 2-decimal strings", async () => {
    const response = await putProfile({ monthlyIncome: "150000.00", monthlyExpenses: "100000" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      userId,
      monthlyIncome: "150000.00",
      monthlyExpenses: "100000.00",
      currency: "LKR",
      createdAt: expect.any(String) as unknown,
      updatedAt: expect.any(String) as unknown,
    });

    const stored = await api.prisma.financialProfile.findUniqueOrThrow({ where: { userId } });
    expect(stored.monthlyIncome?.toFixed(2)).toBe("150000.00");
    expect(stored.monthlyExpenses?.toFixed(2)).toBe("100000.00");
  });

  it("serialises Decimal values exactly and consistently", async () => {
    const response = await putProfile({ monthlyIncome: "0.1", monthlyExpenses: "999999999999.99" });

    expect(response.status).toBe(200);
    expect(response.body.monthlyIncome).toBe("0.10");
    expect(response.body.monthlyExpenses).toBe("999999999999.99");
  });

  it("accepts a profile with amounts not provided yet", async () => {
    const response = await putProfile({ monthlyIncome: "85000.50" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ monthlyIncome: "85000.50", monthlyExpenses: null });
  });

  it("keeps one profile per user and replaces it on every PUT", async () => {
    const first = await putProfile({
      monthlyIncome: "100.00",
      monthlyExpenses: "50.00",
      currency: "USD",
    });

    const second = await putProfile({ monthlyIncome: "200.00" });

    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      monthlyIncome: "200.00",
      monthlyExpenses: null,
      currency: "LKR",
      createdAt: first.body.createdAt,
    });
    expect(await api.prisma.financialProfile.count({ where: { userId } })).toBe(1);
  });

  it("returns 404 and stores nothing for a user that does not exist", async () => {
    // A validly signed token whose user no longer exists.
    const response = await putProfile(
      { monthlyIncome: "100.00" },
      UNKNOWN_ID,
      await api.authHeaders(UNKNOWN_ID),
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "User not found",
    });
    expect(await api.prisma.financialProfile.count()).toBe(0);
  });

  it.each([
    [{ monthlyIncome: "-1.00" }, "monthlyIncome"],
    [{ monthlyExpenses: "-0.01" }, "monthlyExpenses"],
    [{ monthlyIncome: "100.123" }, "monthlyIncome"],
    [{ monthlyExpenses: "1.999" }, "monthlyExpenses"],
    [{ monthlyIncome: 150000.5 }, "monthlyIncome"],
    [{ monthlyIncome: "NaN" }, "monthlyIncome"],
    [{ monthlyIncome: "Infinity" }, "monthlyIncome"],
    [{ monthlyIncome: "abc" }, "monthlyIncome"],
    [{ monthlyIncome: "1000000000000.00" }, "monthlyIncome"],
    [{ currency: "lkr" }, "currency"],
    [{ currency: "LKRS" }, "currency"],
    [{ userId: UNKNOWN_ID }, null],
  ])("rejects %j", async (body, field) => {
    const response = await putProfile(body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fieldsOf(response.body)).toContain(field);
    expect(await api.prisma.financialProfile.count()).toBe(0);
  });
});

describe("GET /api/v1/users/:userId/financial-profile", () => {
  it("returns the profile", async () => {
    const created = await putProfile({ monthlyIncome: "150000.00", monthlyExpenses: "98765.43" });

    const response = await getProfile();

    expect(response.status).toBe(200);
    expect(response.body).toEqual(created.body);
  });

  it("returns 404 when the user has no profile yet", async () => {
    const response = await getProfile();

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ message: "Financial profile not found" });
  });

  it("returns 404 when the user does not exist", async () => {
    const response = await getProfile(UNKNOWN_ID, await api.authHeaders(UNKNOWN_ID));

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ message: "User not found" });
  });
});

describe("financial profile authorization", () => {
  async function otherUser() {
    const other = await api.prisma.user.create({
      data: { phoneNumber: "+94000000302", preferredLanguage: "SI" },
    });
    await api.prisma.financialProfile.create({
      data: { userId: other.id, monthlyIncome: "250000.00", monthlyExpenses: "120000.00" },
    });
    return other.id;
  }

  it("requires authentication (401) for reads and writes", async () => {
    const read = await getProfile(userId, {});
    const write = await putProfile({ monthlyIncome: "1.00" }, userId, {});

    expect(read.status).toBe(401);
    expect(write.status).toBe(401);
    expect(await api.prisma.financialProfile.count()).toBe(0);
  });

  it("User A cannot read User B's profile: 404 like an unknown user, no data", async () => {
    const otherId = await otherUser();

    const response = await getProfile(otherId);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "User not found",
    });
    expect(response.text).not.toContain("250000");
  });

  it("User A cannot overwrite User B's profile", async () => {
    const otherId = await otherUser();

    const response = await putProfile({ monthlyIncome: "1.00" }, otherId);

    expect(response.status).toBe(404);
    const stored = await api.prisma.financialProfile.findUniqueOrThrow({
      where: { userId: otherId },
    });
    expect(stored.monthlyIncome?.toFixed(2)).toBe("250000.00");
  });

  it("an ADMIN gets no access to a user's financial profile", async () => {
    const otherId = await otherUser();

    const response = await getProfile(otherId, await api.authHeaders(userId, "ADMIN"));

    expect(response.status).toBe(404);
  });
});
