import {
  AGENT_TOOL_NAMES,
  INTERNAL_TOKEN_HEADER,
  type ApiErrorResponse,
  type VoiceSessionSetupResponse,
  type VoiceToolExecutionResponse,
} from "@finvoice/contracts";
import {
  calculateBudgetSummary,
  calculateLoanRepayment,
  calculateSavingsPlan,
} from "@finvoice/finance-engine";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AGENT_VERSION,
  buildLiveSystemInstruction,
  MAX_TOOL_CALLS_PER_REQUEST,
} from "../../src/ai/agent/agent.prompt.js";
import { KNOWLEDGE_GUIDANCE } from "../../src/ai/tools/knowledge.tools.js";
import { startTestApi, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";
import { createKnowledgeFixtures } from "./knowledge-fixtures.js";

const SETUP = "/internal/voice/session-setup";
const EXECUTE = "/internal/voice/tools/execute";
/** Test-only token; never a real secret. */
const TOKEN = "internal-test-token-0123456789-abcdef";
const AUTH = { [INTERNAL_TOKEN_HEADER]: TOKEN };

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi({ internalToken: TOKEN });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await truncateAllTables(api.prisma);
  await createKnowledgeFixtures(api.prisma);
});

function execute(body: unknown, headers: Record<string, string> = AUTH) {
  return api.request<VoiceToolExecutionResponse>("POST", EXECUTE, body, headers);
}

describe("internal voice endpoints: access", () => {
  it.each([
    ["no token", {}],
    ["a wrong token", { [INTERNAL_TOKEN_HEADER]: "wrong-token-wrong-token-wrong-token" }],
    ["an empty token", { [INTERNAL_TOKEN_HEADER]: "" }],
    ["the token in another header", { authorization: `Bearer ${TOKEN}` }],
  ])("rejects %s with 401 before validating anything", async (_case, headers) => {
    const setup = await api.request<ApiErrorResponse>(
      "GET",
      `${SETUP}?language=XX`,
      undefined,
      headers,
    );
    const run = await execute({ bogus: true }, headers);

    for (const response of [setup, run]) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        statusCode: 401,
        code: "UNAUTHORIZED",
        message: "Missing or invalid internal token",
      });
      expect(response.text).not.toContain(TOKEN);
    }
  });

  it("is not part of the public /api/v1 API", async () => {
    const response = await api.request("GET", `/api/v1${SETUP}?language=EN`, undefined, AUTH);
    expect(response.status).toBe(404);
  });

  it("answers 503 when the API has no internal token configured", async () => {
    const unconfigured = await startTestApi();
    try {
      const response = await unconfigured.request<ApiErrorResponse>(
        "GET",
        `${SETUP}?language=EN`,
        undefined,
        AUTH,
      );
      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        statusCode: 503,
        code: "SERVICE_UNAVAILABLE",
        message: "Internal endpoints are not configured",
      });
    } finally {
      await unconfigured.close();
    }
  });
});

describe("GET /internal/voice/session-setup", () => {
  it.each(["EN", "SI", "TA"] as const)(
    "returns the server-controlled Live setup for %s",
    async (language) => {
      const response = await api.request<VoiceSessionSetupResponse>(
        "GET",
        `${SETUP}?language=${language}`,
        undefined,
        AUTH,
      );

      expect(response.status).toBe(200);
      expect(response.body.language).toBe(language);
      expect(response.body.agentVersion).toBe(AGENT_VERSION);
      expect(response.body.maxToolCallsPerTurn).toBe(MAX_TOOL_CALLS_PER_REQUEST);
      expect(response.body.systemInstruction).toBe(buildLiveSystemInstruction(language));
      expect(response.body.tools.map((tool) => tool.name)).toEqual([...AGENT_TOOL_NAMES]);
      expect(response.body.tools.every((tool) => tool.parameters.type === "object")).toBe(true);
    },
  );

  it.each([["language=FR"], ["language=si"], [""], ["language=EN&model=other"]])(
    "rejects the query %j",
    async (query) => {
      const response = await api.request<ApiErrorResponse>(
        "GET",
        `${SETUP}?${query}`,
        undefined,
        AUTH,
      );
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    },
  );
});

describe("POST /internal/voice/tools/execute", () => {
  it("runs calculate_loan with the finance engine and adds amounts formatted for speech", async () => {
    const loan = { principal: "500000.00", annualInterestRate: "12.00", termMonths: 36 };

    const response = await execute({ name: "calculate_loan", arguments: loan, language: "EN" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      tool: "calculate_loan",
      isError: false,
      result: {
        ...calculateLoanRepayment(loan),
        spokenAmounts: {
          principal: "Rs. 500,000.00",
          monthlyPayment: "Rs. 16,607.15",
          finalPayment: "Rs. 16,607.33",
          totalRepayment: "Rs. 597,857.58",
          totalInterest: "Rs. 97,857.58",
        },
      },
    });
    // The engine values themselves are unchanged.
    expect(response.body.result).toMatchObject({
      monthlyPayment: "16607.15",
      finalPayment: "16607.33",
      totalRepayment: "597857.58",
      totalInterest: "97857.58",
    });
  });

  it("searches only published knowledge, in the requested language", async () => {
    const response = await execute({
      name: "search_knowledge",
      arguments: { query: "saving" },
      language: "SI",
    });

    expect(response.status).toBe(200);
    expect(response.body.isError).toBe(false);
    expect(response.body.result).toMatchObject({
      guidance: KNOWLEDGE_GUIDANCE,
      requestedLanguage: "SI",
    });
    const slugs = (response.body.result.results as { slug: string }[]).map((r) => r.slug);
    expect(slugs).toContain("saving-basics");
    expect(slugs).not.toContain("budget-draft");
  });

  it("runs calculate_savings and calculate_budget with the finance engine", async () => {
    const savings = { targetAmount: "300000.00", currentAmount: "50000.00", months: 12 };
    const budget = { monthlyIncome: "150000.00", monthlyExpenses: "100000.00" };

    const savingsResponse = await execute({
      name: "calculate_savings",
      arguments: savings,
      language: "TA",
    });
    const budgetResponse = await execute({
      name: "calculate_budget",
      arguments: budget,
      language: "EN",
    });

    expect(savingsResponse.body).toEqual({
      tool: "calculate_savings",
      isError: false,
      result: { ...calculateSavingsPlan(savings), spokenAmounts: expect.any(Object) as unknown },
    });
    expect(savingsResponse.body.result.spokenAmounts).toMatchObject({
      targetAmount: "Rs. 300,000.00",
      remainingAmount: "Rs. 250,000.00",
    });
    expect(budgetResponse.body).toEqual({
      tool: "calculate_budget",
      isError: false,
      result: {
        ...calculateBudgetSummary(budget),
        spokenAmounts: {
          monthlyIncome: "Rs. 150,000.00",
          monthlyExpenses: "Rs. 100,000.00",
          monthlySurplus: "Rs. 50,000.00",
        },
      },
    });
  });

  it("gets one published article and hides drafts", async () => {
    const published = await execute({
      name: "get_knowledge_article",
      arguments: { slug: "saving-basics" },
      language: "EN",
    });
    const draft = await execute({
      name: "get_knowledge_article",
      arguments: { slug: "budget-draft" },
      language: "EN",
    });

    expect(published.body.result).toMatchObject({
      found: true,
      article: { slug: "saving-basics" },
    });
    expect(draft.body.result).toEqual({
      found: false,
      note: "No published FinVoice article has this slug.",
    });
  });

  it("answers an unknown tool with a structured result, not an HTTP error", async () => {
    const response = await execute({
      name: "recommend_bank",
      arguments: { criteria: "lowest rate" },
      language: "EN",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      tool: null,
      isError: true,
      result: {
        error: {
          code: "UNKNOWN_TOOL",
          message: "This tool does not exist. Use only the declared tools.",
        },
      },
    });
  });

  it("validates arguments with the Step 6 tool contracts", async () => {
    const response = await execute({
      name: "calculate_loan",
      arguments: { principal: "500,000", annualInterestRate: "12.00", termMonths: 36 },
      language: "EN",
    });

    expect(response.status).toBe(200);
    expect(response.body.tool).toBe("calculate_loan");
    expect(response.body.isError).toBe(true);
    expect(response.body.result).toMatchObject({ error: { code: "INVALID_ARGUMENTS" } });
  });

  it.each([
    ["missing arguments", { name: "calculate_loan", language: "EN" }],
    ["array arguments", { name: "calculate_loan", arguments: [], language: "EN" }],
    ["an unknown language", { name: "calculate_loan", arguments: {}, language: "FR" }],
    ["extra fields", { name: "calculate_loan", arguments: {}, language: "EN", model: "x" }],
  ])("rejects a request with %s", async (_case, body) => {
    const response = await execute(body);
    expect(response.status).toBe(400);
    expect((response.body as unknown as ApiErrorResponse).code).toBe("VALIDATION_ERROR");
  });
});
