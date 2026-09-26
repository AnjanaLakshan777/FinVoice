import {
  AGENT_TOOL_NAMES,
  calculateBudgetToolInputSchema,
  calculateLoanToolInputSchema,
  calculateSavingsToolInputSchema,
  getKnowledgeArticleToolInputSchema,
  searchKnowledgeToolInputSchema,
  type KnowledgeArticleResponse,
  type ListKnowledgeArticlesQuery,
} from "@finvoice/contracts";
import {
  calculateBudgetSummary,
  calculateLoanRepayment,
  calculateSavingsPlan,
} from "@finvoice/finance-engine";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { toJsonObject } from "../../src/ai/tools/json.js";
import { KNOWLEDGE_GUIDANCE, REVIEW_REQUIRED_NOTE } from "../../src/ai/tools/knowledge.tools.js";
import { AgentToolRegistry } from "../../src/ai/tools/tool-registry.js";
import { ApiException } from "../../src/common/api.exception.js";
import type { KnowledgeService } from "../../src/knowledge/knowledge.service.js";

const ARTICLE: KnowledgeArticleResponse = {
  slug: "emergency-savings",
  category: "SAVING",
  audience: "GENERAL_PUBLIC",
  requestedLanguage: "SI",
  language: "EN",
  translationStatus: "MACHINE_ASSISTED",
  title: "Building emergency savings",
  summary: "An emergency fund is money kept aside for sudden costs.",
  body: "An emergency fund is money you keep aside for sudden, unexpected costs.",
  keywords: ["emergency"],
  source: {
    publisher: "Central Bank of Sri Lanka",
    title: "Financial Literacy Curriculum",
    url: "https://www.cbsl.gov.lk/example-curriculum.pdf",
    type: "OFFICIAL_REGULATOR",
    section: "Chapter 3",
    lastVerifiedAt: "2026-09-26T08:00:00.000Z",
  },
  review: {
    isTimeSensitive: true,
    reviewRequired: true,
    lastReviewedAt: "2026-09-26T08:00:00.000Z",
  },
};

function createRegistry(
  overrides: Partial<Record<"list" | "get", (...args: never[]) => unknown>> = {},
) {
  const knowledge = {
    list: vi.fn(async (query: ListKnowledgeArticlesQuery) => {
      await Promise.resolve();
      return {
        data: [{ ...ARTICLE, requestedLanguage: query.language }],
        meta: { page: 1, limit: 3, total: 1, totalPages: 1 },
      };
    }),
    get: vi.fn(async (slug: string) => {
      await Promise.resolve();
      if (slug !== ARTICLE.slug) {
        throw ApiException.notFound("Knowledge article not found");
      }
      return ARTICLE;
    }),
    ...overrides,
  };
  return { registry: new AgentToolRegistry(knowledge as unknown as KnowledgeService), knowledge };
}

const CONTEXT = { language: "EN" as const };

async function run(
  name: string,
  args: unknown,
  context: { language: "EN" | "SI" | "TA" } = CONTEXT,
) {
  const { registry } = createRegistry();
  return registry.execute({ id: "call-1", name, arguments: args }, context);
}

describe("tool registration", () => {
  it("declares exactly the allowlisted tools, in order", () => {
    const { registry } = createRegistry();

    expect(registry.declarations().map((declaration) => declaration.name)).toEqual([
      ...AGENT_TOOL_NAMES,
    ]);
  });

  it.each([
    ["search_knowledge", searchKnowledgeToolInputSchema],
    ["get_knowledge_article", getKnowledgeArticleToolInputSchema],
    ["calculate_loan", calculateLoanToolInputSchema],
    ["calculate_savings", calculateSavingsToolInputSchema],
    ["calculate_budget", calculateBudgetToolInputSchema],
  ] as const)("declares %s with the same fields as its input contract", (name, schema) => {
    const { registry } = createRegistry();
    const declaration = registry.declarations().find((candidate) => candidate.name === name);
    const shape = (schema as unknown as z.ZodObject).shape;
    const requiredFields = Object.entries(shape)
      .filter(([, field]) => !(field as z.ZodType).safeParse(undefined).success)
      .map(([key]) => key);

    expect(declaration?.description.length).toBeGreaterThan(20);
    expect(declaration?.parameters.type).toBe("object");
    expect(Object.keys(declaration?.parameters.properties as object).sort()).toEqual(
      Object.keys(shape).sort(),
    );
    expect([...(declaration?.parameters.required as string[])].sort()).toEqual(
      requiredFields.sort(),
    );
  });
});

describe("calculation tools", () => {
  it("returns the finance engine's loan result unchanged", async () => {
    const input = { principal: "500000.00", annualInterestRate: "12.00", termMonths: 36 };

    const execution = await run("calculate_loan", input);

    expect(execution).toEqual({
      tool: "calculate_loan",
      isError: false,
      result: calculateLoanRepayment(input),
    });
    expect(execution.result).toMatchObject({
      monthlyPayment: "16607.15",
      finalPayment: "16607.33",
      totalRepayment: "597857.58",
      totalInterest: "97857.58",
      calculationVersion: "1",
    });
  });

  it("returns the finance engine's savings and budget results unchanged", async () => {
    const savings = { targetAmount: "300000.00", currentAmount: "50000.00", months: 12 };
    const budget = { monthlyIncome: "150000.00", monthlyExpenses: "100000.00" };

    expect((await run("calculate_savings", savings)).result).toEqual(calculateSavingsPlan(savings));
    expect((await run("calculate_budget", budget)).result).toEqual(calculateBudgetSummary(budget));
  });

  it.each([
    [
      "calculate_loan",
      {
        principal: "500000.00",
        annualInterestRate: "12.00",
        termMonths: 36,
        monthlyPayment: "1.00",
      },
    ],
    [
      "calculate_loan",
      {
        principal: "500000.00",
        annualInterestRate: "12.00",
        termMonths: 36,
        totalInterest: "0.00",
      },
    ],
    ["calculate_loan", { principal: "1e5", annualInterestRate: "12", termMonths: 36 }],
    ["calculate_loan", { principal: "-500000", annualInterestRate: "12", termMonths: 36 }],
    ["calculate_loan", { principal: 500000, annualInterestRate: "12", termMonths: 36 }],
    ["calculate_loan", { principal: "500000", annualInterestRate: "12", termMonths: 0 }],
    ["calculate_loan", { principal: "500000", annualInterestRate: "12", termMonths: 601 }],
    ["calculate_loan", { principal: "500000", annualInterestRate: "12", termMonths: 36.5 }],
    ["calculate_loan", { principal: "500000.123", annualInterestRate: "12", termMonths: 36 }],
    ["calculate_savings", { targetAmount: "1000", currentAmount: "1000.01", months: 12 }],
    ["calculate_savings", { targetAmount: "0", currentAmount: "0", months: 12 }],
    ["calculate_savings", { targetAmount: "1000", currentAmount: "0", months: 0 }],
    ["calculate_budget", { monthlyIncome: "-1", monthlyExpenses: "0" }],
    ["calculate_budget", { monthlyIncome: "100", monthlyExpenses: "NaN" }],
    ["calculate_budget", { monthlyIncome: "100", monthlyExpenses: "50", monthlySurplus: "50" }],
    ["calculate_budget", "not an object"],
    ["calculate_budget", null],
  ])("%s rejects the arguments %j with a structured error", async (name, args) => {
    const execution = await run(name, args);

    expect(execution.isError).toBe(true);
    expect(execution.tool).toBe(name);
    expect(execution.result).toMatchObject({ error: { code: "INVALID_ARGUMENTS" } });
    expect((execution.result.error as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
  });
});

describe("knowledge tools", () => {
  it("searches published knowledge through KnowledgeService, bounded, in the user's language", async () => {
    const { registry, knowledge } = createRegistry();

    const execution = await registry.execute(
      { id: "c", name: "search_knowledge", arguments: { query: "emergency fund" } },
      { language: "SI" },
    );

    expect(knowledge.list).toHaveBeenCalledWith({
      query: "emergency fund",
      language: "SI",
      page: 1,
      limit: 3,
    });
    expect(execution.isError).toBe(false);
    expect(execution.result).toEqual({
      guidance: KNOWLEDGE_GUIDANCE,
      requestedLanguage: "SI",
      totalMatches: 1,
      results: [
        {
          slug: "emergency-savings",
          category: "SAVING",
          requestedLanguage: "SI",
          language: "EN",
          authoritativeContent: {
            title: ARTICLE.title,
            summary: ARTICLE.summary,
            body: ARTICLE.body,
          },
          source: {
            publisher: "Central Bank of Sri Lanka",
            title: "Financial Literacy Curriculum",
            url: ARTICLE.source.url,
            section: "Chapter 3",
            lastVerifiedAt: "2026-09-26T08:00:00.000Z",
          },
          review: { isTimeSensitive: true, reviewRequired: true, note: REVIEW_REQUIRED_NOTE },
        },
      ],
    });
  });

  it("passes an explicit language and category through", async () => {
    const { registry, knowledge } = createRegistry();

    await registry.execute(
      {
        id: "c",
        name: "search_knowledge",
        arguments: { query: "scam", language: "TA", category: "SCAMS" },
      },
      CONTEXT,
    );

    expect(knowledge.list).toHaveBeenCalledWith({
      query: "scam",
      language: "TA",
      category: "SCAMS",
      page: 1,
      limit: 3,
    });
  });

  it.each([
    { query: "" },
    { query: "x".repeat(101) },
    { query: "loan", language: "FR" },
    { query: "loan", category: "CRYPTO" },
    { query: "loan", sql: "DROP TABLE users" },
    {},
  ])("search_knowledge rejects %j", async (args) => {
    const execution = await run("search_knowledge", args);

    expect(execution.result).toMatchObject({ error: { code: "INVALID_ARGUMENTS" } });
  });

  it("returns an article with its source, and a safe not-found result for unknown slugs", async () => {
    const found = await run("get_knowledge_article", { slug: "emergency-savings", language: "SI" });
    const missing = await run("get_knowledge_article", { slug: "budget-draft" });

    expect(found.result).toMatchObject({
      found: true,
      article: {
        slug: "emergency-savings",
        language: "EN",
        source: { publisher: "Central Bank of Sri Lanka" },
      },
    });
    expect(missing).toEqual({
      tool: "get_knowledge_article",
      isError: false,
      result: { found: false, note: "No published FinVoice article has this slug." },
    });
  });

  it("turns an unexpected failure into a safe result without internal details", async () => {
    const { registry } = createRegistry({
      list: () =>
        Promise.reject(new Error("connect ECONNREFUSED postgresql://user:secret@db:5432/finvoice")),
    });

    const execution = await registry.execute(
      { id: "c", name: "search_knowledge", arguments: { query: "loan" } },
      CONTEXT,
    );

    expect(execution).toMatchObject({ isError: true, result: { error: { code: "TOOL_FAILED" } } });
    expect(JSON.stringify(execution)).not.toMatch(/secret|postgresql|ECONNREFUSED| {4}at /);
  });
});

describe("tool safety", () => {
  it.each([
    "run_sql",
    "fetch_url",
    "readFile",
    "calculateLoanRepayment",
    "__proto__",
    "constructor",
  ])("rejects the unknown tool %s without running anything", async (name) => {
    const execution = await run(name, {});

    expect(execution).toEqual({
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

  it("only sends plain JSON to the model", () => {
    class DecimalLike {
      constructor(readonly value: string) {}
    }
    expect(toJsonObject({ amount: "1.00", nested: [{ ok: true, n: 1, none: null }] })).toEqual({
      amount: "1.00",
      nested: [{ ok: true, n: 1, none: null }],
    });
    expect(() => toJsonObject({ amount: new DecimalLike("1.00") })).toThrow(TypeError);
    expect(() => toJsonObject({ when: new Date() })).toThrow(TypeError);
    expect(() => toJsonObject({ value: Number.NaN })).toThrow(TypeError);
    expect(() => toJsonObject({ fn: () => 1 })).toThrow(TypeError);
    expect(() => toJsonObject([1, 2])).toThrow(TypeError);
  });

  it("reports a tool result that is not plain JSON as a failure instead of sending it", async () => {
    // A Date (like a raw Prisma field) where the tool expects a string.
    const { registry } = createRegistry({
      list: () =>
        Promise.resolve({
          data: [
            {
              ...ARTICLE,
              source: { ...ARTICLE.source, lastVerifiedAt: new Date(), id: "internal-id" },
            },
          ],
          meta: { page: 1, limit: 3, total: 1, totalPages: 1 },
        }),
    });

    const execution = await registry.execute(
      { id: "c", name: "search_knowledge", arguments: { query: "loan" } },
      CONTEXT,
    );

    expect(execution.result).toMatchObject({ error: { code: "TOOL_FAILED" } });
    expect(JSON.stringify(execution)).not.toContain("internal-id");
  });
});
