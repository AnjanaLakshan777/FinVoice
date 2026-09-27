import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type {
  AnalyticsHealthResponse,
  AnalyticsKnowledgeResponse,
  AnalyticsLanguageResponse,
  AnalyticsLiteracyResponse,
  AnalyticsOverviewResponse,
  AnalyticsRange,
  AnalyticsReviewQueueResponse,
  AnalyticsScamShieldResponse,
  AnalyticsToolResponse,
  AnalyticsTrendResponse,
} from "@finvoice/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminPage from "../app/admin/page";
import { UNAVAILABLE_MESSAGE } from "../app/admin/sections";
import { parseDashboardRange } from "../lib/admin/range";

const TOKEN = "admin-dashboard-test-token-must-stay-server-side-0123456789";
const API_URL = "http://internal-api.test:4000";
const RANGE: AnalyticsRange = {
  from: "2026-09-01",
  to: "2026-09-03",
  timezone: "Asia/Colombo",
  days: 3,
};

const LANGUAGES = [
  { language: "SI", count: 6, percentage: "50.00" },
  { language: "TA", count: 2, percentage: "16.67" },
  { language: "EN", count: 4, percentage: "33.33" },
] as const;

const FIXTURES = {
  overview: {
    range: RANGE,
    interactions: {
      total: 1240,
      agent: 420,
      voice: 310,
      scamshield: 190,
      calculations: 320,
      knowledge: 0,
    },
    successRate: "98.50",
    averageResponseMs: 4200,
    p95ResponseMs: 9100,
    responseSampleSize: 930,
  } satisfies AnalyticsOverviewResponse,
  trends: {
    range: RANGE,
    data: [
      {
        date: "2026-09-01",
        agentRequests: 2,
        voiceSessions: 1,
        scamAnalyses: 0,
        calculations: 3,
        knowledgeRequests: 0,
        total: 6,
      },
      {
        date: "2026-09-02",
        agentRequests: 0,
        voiceSessions: 0,
        scamAnalyses: 0,
        calculations: 0,
        knowledgeRequests: 0,
        total: 0,
      },
      {
        date: "2026-09-03",
        agentRequests: 5,
        voiceSessions: 2,
        scamAnalyses: 1,
        calculations: 0,
        knowledgeRequests: 1,
        total: 9,
      },
    ],
  } satisfies AnalyticsTrendResponse,
  languages: { range: RANGE, total: 12, data: [...LANGUAGES] } satisfies AnalyticsLanguageResponse,
  knowledge: {
    range: RANGE,
    searches: 3,
    articleViews: 5,
    categories: [
      { category: "SCAMS", count: 5, percentage: "62.50" },
      { category: "SAVING", count: 3, percentage: "37.50" },
      { category: "BUDGETING", count: 0, percentage: "0.00" },
    ],
    languages: [...LANGUAGES],
    articles: { published: 12, translated: 4, timeSensitive: 2, reviewRequired: 0 },
  } satisfies AnalyticsKnowledgeResponse,
  scamshield: {
    range: RANGE,
    total: 4,
    successRate: "100.00",
    riskLevels: [
      { riskLevel: "INSUFFICIENT_INFORMATION", count: 0, percentage: "0.00" },
      { riskLevel: "LOW", count: 1, percentage: "25.00" },
      { riskLevel: "MEDIUM", count: 1, percentage: "25.00" },
      { riskLevel: "HIGH", count: 2, percentage: "50.00" },
    ],
    sourceTypes: [
      { sourceType: "MESSAGE", count: 3, percentage: "75.00" },
      { sourceType: "CALL", count: 1, percentage: "25.00" },
    ],
    languages: [...LANGUAGES],
  } satisfies AnalyticsScamShieldResponse,
  literacy: {
    range: RANGE,
    topicsStarted: 3,
    topicsCompleted: 1,
    byCategory: [{ category: "SAVING", started: 3, completed: 1 }],
    languages: [...LANGUAGES],
    profiles: {
      total: 3,
      assessed: 1,
      unassessed: 2,
      levels: [
        { level: "BEGINNER", count: 2 },
        { level: "DEVELOPING", count: 1 },
        { level: "CONFIDENT", count: 0 },
      ],
    },
  } satisfies AnalyticsLiteracyResponse,
  tools: {
    range: RANGE,
    total: 7,
    data: [{ toolName: "calculate_loan", calls: 7, agentCalls: 5, voiceCalls: 2, failed: 1 }],
  } satisfies AnalyticsToolResponse,
  health: {
    range: RANGE,
    totalEvents: 20,
    failedEvents: 1,
    failureRate: "5.00",
    recordingFailuresSinceStart: 0,
    byEventType: [
      {
        eventType: "AGENT_REQUEST",
        total: 7,
        failed: 1,
        latency: { sampleSize: 3, averageMs: 4200, p50Ms: null, p95Ms: null },
      },
    ],
    errorCodes: [{ errorCode: "BAD_GATEWAY", count: 1 }],
  } satisfies AnalyticsHealthResponse,
  "knowledge-review": {
    generatedAt: "2026-09-03T10:00:00.000Z",
    publishedArticles: 12,
    timeSensitiveArticles: 2,
    reviewRequired: 0,
    buckets: { OVERDUE: 0, DUE_WITHIN_7_DAYS: 0, DUE_WITHIN_30_DAYS: 1, LATER: 11 },
    articles: [
      {
        slug: "deposit-insurance",
        title: "Deposit insurance in Sri Lanka",
        category: "DEPOSIT_PROTECTION",
        isTimeSensitive: true,
        reviewRequired: false,
        nextReviewAt: "2026-09-26T08:00:00.000Z",
        bucket: "DUE_WITHIN_30_DAYS",
      },
    ],
  } satisfies AnalyticsReviewQueueResponse,
};

type Section = keyof typeof FIXTURES;

function urlOf(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function sectionOf(url: string): Section {
  const path = new URL(url).pathname;
  return path.slice("/internal/admin/analytics/".length) as Section;
}

/** Fakes the internal API. `status` per section (default 200 with its fixture). */
function stubApi(status: Partial<Record<Section, number>> = {}, fixtures = FIXTURES) {
  const fetchMock = vi.fn<typeof fetch>((input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const section = sectionOf(url);
    const code = status[section] ?? 200;
    return Promise.resolve(
      new Response(code === 200 ? JSON.stringify(fixtures[section]) : "{}", {
        status: code,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderPage(params: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  vi.stubEnv("ADMIN_DASHBOARD_ENABLED", "true");
  vi.stubEnv("INTERNAL_API_URL", API_URL);
  vi.stubEnv("INTERNAL_API_TOKEN", TOKEN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("admin dashboard availability", () => {
  it.each([["false"], [undefined], ["yes"]])(
    "is a 404 when ADMIN_DASHBOARD_ENABLED=%s, without calling the API",
    async (value) => {
      if (value === undefined) {
        vi.stubEnv("ADMIN_DASHBOARD_ENABLED", undefined);
      } else {
        vi.stubEnv("ADMIN_DASHBOARD_ENABLED", value);
      }
      const fetchMock = stubApi();

      const error = await AdminPage({ searchParams: Promise.resolve({}) }).catch(
        (caught: unknown) => caught,
      );

      expect(String((error as { digest?: string }).digest)).toContain("404");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe("admin dashboard data", () => {
  it("renders every section from server-side calls to the internal API", async () => {
    const fetchMock = stubApi();

    const html = await renderPage({ range: "custom", from: "2026-09-01", to: "2026-09-03" });

    expect(html).toContain("<h1>FinVoice Admin</h1>");
    for (const text of [
      "Total interactions",
      "1,240",
      "98.50%",
      "4.2 s",
      "9.1 s",
      "Interaction trend",
      "Sinhala",
      "Financial literacy",
      "ScamShield",
      "High",
      "Knowledge topics",
      "Knowledge review queue",
      "Deposit insurance in Sri Lanka",
      "Loan calculator",
      "BAD_GATEWAY (1)",
    ]) {
      expect(html, text).toContain(text);
    }
    expect(fetchMock).toHaveBeenCalledTimes(9);
    for (const [input, init] of fetchMock.mock.calls) {
      expect(urlOf(input)).toMatch(
        /^http:\/\/internal-api\.test:4000\/internal\/admin\/analytics\//u,
      );
      expect(init?.headers).toMatchObject({ "x-finvoice-internal-token": TOKEN });
      expect(init?.cache).toBe("no-store");
    }
    const [firstInput] = fetchMock.mock.calls[0] ?? [""];
    expect(urlOf(firstInput)).toContain("from=2026-09-01&to=2026-09-03");
  });

  it("never puts the token or the internal API address into the page", async () => {
    stubApi();
    const html = await renderPage();

    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain("internal-api.test");
    expect(html).not.toContain("/internal/");
    expect(html).not.toContain("INTERNAL_API_TOKEN");
  });

  it("shows percentiles as unavailable for small samples", async () => {
    stubApi();
    const html = await renderPage();
    // AGENT_REQUEST has 3 samples: average shown, p50/p95 as a dash.
    expect(html).toMatch(
      /AI agent requests<\/th><td>7<\/td><td>1<\/td><td>4\.2 s<\/td><td>—<\/td><td>—<\/td>/u,
    );
  });

  it("keeps the page working when one section fails", async () => {
    stubApi({ scamshield: 500, tools: 503 });
    const html = await renderPage();

    expect(html.split(UNAVAILABLE_MESSAGE)).toHaveLength(3);
    expect(html).toContain("1,240");
    expect(html).not.toMatch(/500|503|Internal|stack/u);
  });

  it("shows a calm message for every section when the API is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1"))),
    );
    const html = await renderPage();

    expect(html.split(UNAVAILABLE_MESSAGE)).toHaveLength(10);
    expect(html).not.toContain("ECONNREFUSED");
  });

  it("shows the data as unavailable without a token, and never calls the API", async () => {
    vi.stubEnv("INTERNAL_API_TOKEN", "");
    const fetchMock = stubApi();
    const html = await renderPage();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(html).toContain(UNAVAILABLE_MESSAGE);
  });

  it("reports an invalid date range from the API", async () => {
    stubApi({ overview: 400 });
    const html = await renderPage({ range: "custom", from: "2025-01-01", to: "2026-09-03" });

    expect(html).toContain("This date range is not valid");
  });

  it("shows empty states instead of broken charts", async () => {
    const empty = structuredClone(FIXTURES);
    empty.trends.data = empty.trends.data.map((day) => ({
      ...day,
      agentRequests: 0,
      voiceSessions: 0,
      scamAnalyses: 0,
      calculations: 0,
      knowledgeRequests: 0,
      total: 0,
    }));
    empty.languages.total = 0;
    empty.scamshield.total = 0;
    empty.literacy.byCategory = [];
    empty.tools.data = [];
    empty["knowledge-review"].articles = [];
    stubApi({}, empty);

    const html = await renderPage();

    for (const text of [
      "No interactions in this period.",
      "No language data in this period.",
      "No ScamShield analyses in this period.",
      "No literacy progress in this period.",
      "No tool calls in this period.",
      "No articles are due for review within 30 days.",
    ]) {
      expect(html, text).toContain(text);
    }
  });

  it("labels every range control and gives charts text summaries", async () => {
    stubApi();
    const html = await renderPage();

    expect(html).toContain('<select name="range"');
    expect(html).toMatch(/<label>Period/u);
    expect(html).toMatch(/<label>From/u);
    expect(html).toMatch(/<label>To/u);
    expect(html).toContain("Busiest day");
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("dashboard range selection", () => {
  const NOW = new Date("2026-09-27T20:00:00Z"); // 28 September in Asia/Colombo (UTC+05:30)

  it.each([
    [{}, "30", "2026-08-30", "2026-09-28"],
    [{ range: "7" }, "7", "2026-09-22", "2026-09-28"],
    [{ range: "90" }, "90", "2026-07-01", "2026-09-28"],
    [
      { range: "custom", from: "2026-01-01", to: "2026-01-31" },
      "custom",
      "2026-01-01",
      "2026-01-31",
    ],
    [{ range: "custom", from: "not-a-date", to: "2026-01-31" }, "30", "2026-08-30", "2026-09-28"],
  ])("%j → %s days", (params, preset, from, to) => {
    expect(parseDashboardRange(params, NOW)).toEqual({ preset, from, to });
  });
});

describe("token isolation (source code)", () => {
  const root = join(import.meta.dirname, "..");

  function files(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      if (["node_modules", ".next", "test"].includes(name)) {
        return [];
      }
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  }

  const sources = files(root)
    .filter((path) => /\.(ts|tsx)$/u.test(path))
    .map((path) => ({ path, text: readFileSync(path, "utf8") }));

  it("has no client component in the admin dashboard", () => {
    for (const { path, text } of sources.filter(({ path }) =>
      /[\\/](app|lib)[\\/]admin[\\/]/u.test(path),
    )) {
      expect(text, path).not.toMatch(/^["']use client["']/mu);
    }
  });

  it("never exposes the internal token or URL through NEXT_PUBLIC_ variables", () => {
    for (const { path, text } of sources) {
      expect(text, path).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(TOKEN|INTERNAL)/u);
    }
  });

  it("reads the token only in the server-side admin library", () => {
    // Code only: comments that document the token do not read it.
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
    const readers = sources
      .filter(({ text }) => /INTERNAL_API_TOKEN|internalApi\b/u.test(code(text)))
      .map(({ path }) => path.slice(root.length + 1).replace(/\\/gu, "/"))
      .sort();
    expect(readers).toEqual(["lib/admin/analytics-client.ts", "lib/admin/config.ts"]);
  });
});

describe("invalid ranges", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows only the explanation and the review queue, not misleading 'unavailable' sections", async () => {
    stubApi({
      overview: 400,
      trends: 400,
      languages: 400,
      knowledge: 400,
      scamshield: 400,
      literacy: 400,
      tools: 400,
      health: 400,
    });
    const html = await renderPage({ range: "custom", from: "2024-01-01", to: "2026-09-03" });

    expect(html).toContain("This date range is not valid");
    expect(html).not.toContain(UNAVAILABLE_MESSAGE);
    expect(html).toContain("Knowledge review queue");
    expect(html).not.toContain("Total interactions");
  });
});

describe("admin proxy (real 404 status before rendering)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers 404 while the dashboard is disabled, and passes through when enabled", async () => {
    const { proxy, config } = await import("../proxy");
    expect(config.matcher).toEqual(["/admin", "/admin/:path*"]);

    vi.stubEnv("ADMIN_DASHBOARD_ENABLED", "false");
    const disabled = proxy();
    expect(disabled.status).toBe(404);
    expect(await disabled.text()).toBe("Not found");

    vi.stubEnv("ADMIN_DASHBOARD_ENABLED", "true");
    const enabled = proxy();
    expect(enabled.status).toBe(200);
    expect(enabled.headers.get("x-middleware-next")).toBe("1");
  });
});
