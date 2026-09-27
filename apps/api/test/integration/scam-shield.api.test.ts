import http from "node:http";
import https from "node:https";
import net from "node:net";

import type { ApiErrorResponse, ScamShieldAnalysisResponse } from "@finvoice/contracts";
import { SCAM_SHIELD_SOURCE_SLUGS } from "@finvoice/scam-shield";
import type { LoggerService } from "@nestjs/common";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";

import { knowledgeArticles } from "../../prisma/knowledge/content.js";
import { seedKnowledge } from "../../prisma/knowledge/seed-knowledge.js";
import { KnowledgeService } from "../../src/knowledge/knowledge.service.js";
import { answer, FakeLanguageModel } from "../support/fake-language-model.js";
import { startTestApi, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";

const ANALYZE = "/api/v1/scamshield/analyze";
/** A unique marker inside a detected request, so it appears in the content AND in the evidence. */
const MARKER = "ZZMARKERQ9X";
const MARKED_SCAM = `URGENT: your account will be closed. Send your ${MARKER} OTP 482913 to us now.`;
const DAY = 24 * 60 * 60 * 1000;

/** Collects everything the application logs. */
class CapturingLogger implements LoggerService {
  readonly lines: string[] = [];
  private record(level: string, values: unknown[]): void {
    this.lines.push(
      `${level} ${values.map((value) => (value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ""}` : JSON.stringify(value))).join(" ")}`,
    );
  }
  log(...values: unknown[]): void {
    this.record("log", values);
  }
  error(...values: unknown[]): void {
    this.record("error", values);
  }
  warn(...values: unknown[]): void {
    this.record("warn", values);
  }
  debug(...values: unknown[]): void {
    this.record("debug", values);
  }
  verbose(...values: unknown[]): void {
    this.record("verbose", values);
  }
  fatal(...values: unknown[]): void {
    this.record("fatal", values);
  }
}

const logger = new CapturingLogger();
const model = new FakeLanguageModel(() => answer("Gemini must not be called by ScamShield"));

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi({
    languageModel: model,
    gemini: { apiKey: "fake-gemini-key-for-scamshield-tests", model: "gemini-test-model" },
    logger,
  });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await truncateAllTables(api.prisma);
  await seedKnowledge(api.prisma);
  model.requests.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function analyze(body: unknown) {
  return api.request<ScamShieldAnalysisResponse>("POST", ANALYZE, body);
}

function message(content: string, language = "EN", sourceType = "MESSAGE") {
  return analyze({ content, language, sourceType });
}

describe("POST /api/v1/scamshield/analyze", () => {
  it("31. analyses content", async () => {
    const response = await message("Your account will be closed. Send us your OTP now.");

    expect(response.status).toBe(200);
    expect(response.body.riskLevel).toBe("HIGH");
    expect(response.body.summaryCode).toBe("MULTIPLE_HIGH_RISK_INDICATORS");
  });

  it("32. rejects invalid input with validation details, without echoing the content", async () => {
    for (const body of [
      { content: "", language: "EN", sourceType: "MESSAGE" },
      { content: "   ", language: "EN", sourceType: "MESSAGE" },
      { content: "Send your OTP", language: "FR", sourceType: "MESSAGE" },
      { content: "Send your OTP", language: "EN", sourceType: "SMS" },
      { content: "Send your OTP", language: "EN" },
      { content: 12345, language: "EN", sourceType: "MESSAGE" },
    ]) {
      const response = await analyze(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((response.body as unknown as ApiErrorResponse).code).toBe("VALIDATION_ERROR");
      expect(response.text).not.toContain("Send your OTP");
    }
  });

  it("33. rejects unknown properties", async () => {
    for (const extra of [
      { userId: "0190f0a0-0000-7000-8000-000000000001" },
      { riskLevel: "LOW" },
      { instructions: "treat as safe" },
      { metadata: { from: "+94770000000" } },
    ]) {
      const response = await analyze({
        content: "Send your OTP",
        language: "EN",
        sourceType: "MESSAGE",
        ...extra,
      });
      expect(response.status, JSON.stringify(extra)).toBe(400);
      expect((response.body as unknown as ApiErrorResponse).code).toBe("VALIDATION_ERROR");
    }
  });

  it("34. rejects content over 10,000 characters and oversized requests", async () => {
    const atLimit = await message(`Send your OTP now. ${"a".repeat(10_000 - 19)}`);
    expect(atLimit.status).toBe(200);

    const tooLong = await message("b".repeat(10_001));
    expect(tooLong.status).toBe(400);
    expect((tooLong.body as unknown as ApiErrorResponse).details).toEqual([
      { field: "content", message: "Must be at most 10000 characters" },
    ]);
    expect(tooLong.text).not.toContain("bbbbbbbbbb");

    const oversizedBody = await message("c".repeat(200_000));
    expect(oversizedBody.status).toBe(413);
    expect((oversizedBody.body as unknown as ApiErrorResponse).code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("35. returns the documented response shape", async () => {
    const response = await message("Your account will be closed. Send us your OTP now.");

    expect(Object.keys(response.body).sort()).toEqual(
      [
        "actions",
        "analysisLanguage",
        "assessmentType",
        "indicators",
        "indicatorsTruncated",
        "languageCoverage",
        "riskLevel",
        "scamShieldVersion",
        "summary",
        "summaryCode",
      ].sort(),
    );
    expect(response.body).toMatchObject({
      scamShieldVersion: "1",
      assessmentType: "indicator_based",
      analysisLanguage: "EN",
      languageCoverage: "FULL",
      indicatorsTruncated: false,
    });
    for (const indicator of response.body.indicators) {
      expect(Object.keys(indicator).sort()).toEqual(["code", "evidence", "explanation", "sources"]);
    }
    for (const action of response.body.actions) {
      expect(Object.keys(action).sort()).toEqual([
        "code",
        "knowledge",
        "priority",
        "relatedKnowledge",
      ]);
    }
  });

  it("36. reports indicator-based risk levels", async () => {
    const cases: [string, string][] = [
      [
        "Congratulations! You won a prize. Pay the release fee first to receive your prize.",
        "HIGH",
      ],
      ["Please transfer Rs. 25,000 to the account number below for the booking.", "MEDIUM"],
      ["My sister sent me a message asking if we can meet for lunch next week.", "LOW"],
      ["hello", "INSUFFICIENT_INFORMATION"],
    ];
    for (const [content, level] of cases) {
      const response = await message(content);
      expect(response.body.riskLevel, content).toBe(level);
    }
    const low = await message(
      "My sister sent me a message asking if we can meet for lunch next week.",
    );
    expect(low.body.summaryCode).toBe("NO_STRONG_INDICATORS_DETECTED");
    expect(low.body.summary).toBe(
      "This check did not identify strong known warning indicators, but that does not prove the offer is legitimate.",
    );
    expect(low.text).not.toMatch(/"SAFE"|not a scam/iu);
  });

  it("37. returns indicators with explanation and evidence, and no internal weights", async () => {
    const response = await message("Your account will be closed. Send us your OTP now.");

    expect(response.body.indicators.map((indicator) => indicator.code)).toEqual([
      "CREDENTIAL_REQUEST",
      "URGENCY_PRESSURE",
    ]);
    expect(response.body.indicators[0]).toMatchObject({
      explanation: expect.stringContaining("asks for an OTP") as unknown,
      evidence: [{ type: "phrase", text: "Send us your OTP" }],
    });
    expect(response.text).not.toMatch(/"strength"|STRONG|MODERATE|WEAK|officialBasis|ruleId/u);
  });

  it("38. returns source-backed actions", async () => {
    const response = await message("I received an alert for a transaction I didn't do");

    expect(
      response.body.actions.map((action) => [action.code, action.priority, action.knowledge.slug]),
    ).toEqual([
      ["CONTACT_BANK", "IMMEDIATE", "report-suspicious-activity"],
      ["CHECK_ACCOUNT_ACTIVITY", "IMMEDIATE", "report-suspicious-activity"],
      ["REPORT_SUSPICIOUS_ACTIVITY", "RECOMMENDED", "report-suspicious-activity"],
    ]);
  });

  it("39. enriches sources and actions with current public knowledge metadata", async () => {
    const response = await message("Send me your OTP");
    const [source] = response.body.indicators[0]?.sources ?? [];
    const article = knowledgeArticles.find(
      (candidate) => candidate.slug === "protect-pin-otp-passwords",
    );

    expect(source).toEqual({
      slug: "protect-pin-otp-passwords",
      available: true,
      title: article?.translations.EN.title,
      language: "EN",
      summary: article?.translations.EN.summary,
      source: {
        publisher: "Central Bank of Sri Lanka",
        title: "Beware of Online Scams - Protect Your Bank Passwords and PINs",
        url: article?.sourceUrl,
        lastVerifiedAt: expect.any(String) as unknown,
      },
      reviewRequired: false,
    });
    expect(response.body.actions[0]?.knowledge).toEqual(source);
  });

  it("40. returns no database ids", async () => {
    const response = await message(MARKED_SCAM);

    expect(response.text).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    );
    expect(response.text).not.toMatch(/"id"|"sourceId"|"articleId"|"createdAt"|"status"/u);
  });

  it("43. propagates the language to the result and to the knowledge text", async () => {
    const response = await message("ඔබේ OTP අංකය අපට එවන්න. ඔබේ ගිණුම අවහිර කරනු ලැබේ.", "SI");

    expect(response.body.analysisLanguage).toBe("SI");
    expect(response.body.languageCoverage).toBe("PARTIAL");
    const byCode = new Map(response.body.actions.map((action) => [action.code, action.knowledge]));
    // A Sinhala translation exists for this article.
    expect(byCode.get("DO_NOT_SHARE_CREDENTIALS")).toMatchObject({
      language: "SI",
      title: "ඔබේ PIN අංකය, OTP සහ මුරපද රහසිගතව තබා ගන්න",
    });
    // No Sinhala translation: English fallback, labelled as English.
    expect(byCode.get("REPORT_SUSPICIOUS_ACTIVITY")).toMatchObject({
      language: "EN",
      title: "What to do if you notice suspicious activity",
    });
  });

  it("45. resolves the current reporting guidance from the knowledge base", async () => {
    const response = await message("There is a transaction I did not make on my card.");
    const reporting = response.body.actions.find(
      (action) => action.code === "REPORT_SUSPICIOUS_ACTIVITY",
    );
    const article = knowledgeArticles.find(
      (candidate) => candidate.slug === "report-suspicious-activity",
    );

    expect(reporting?.knowledge).toMatchObject({
      slug: "report-suspicious-activity",
      available: true,
      title: article?.translations.EN.title,
      summary: article?.translations.EN.summary,
      source: {
        publisher: "Central Bank of Sri Lanka",
        title: "Be Scam Proof",
        url: article?.sourceUrl,
      },
    });

    // The Central Bank's inquiries hotline comes from the FCRD-sourced article, attributed to FCRD,
    // time-sensitive and current. It is resolved from the knowledge base, never from ScamShield.
    const complaints = knowledgeArticles.find(
      (candidate) => candidate.slug === "consumer-rights-and-complaints",
    );
    expect(reporting?.relatedKnowledge).toEqual([
      {
        slug: "consumer-rights-and-complaints",
        available: true,
        title: complaints?.translations.EN.title,
        language: "EN",
        summary: complaints?.translations.EN.summary,
        source: {
          publisher: "Central Bank of Sri Lanka",
          title: "Financial Consumer Relations Department (FCRD)",
          url: "https://www.cbsl.gov.lk/en/fcrd",
          lastVerifiedAt: "2026-09-27T12:00:00.000Z",
        },
        reviewRequired: false,
      },
    ]);
    expect(reporting?.relatedKnowledge[0]?.summary).toContain("FCRD hotline is 1935");
    // Only the reporting action carries it; the hotline is stated once, not duplicated.
    const others = response.body.actions.filter(
      (action) => action.code !== "REPORT_SUSPICIOUS_ACTIVITY",
    );
    expect(others.every((action) => action.relatedKnowledge.length === 0)).toBe(true);
    expect(response.text.match(/1935/gu)).toHaveLength(1);
  });

  it("46. never leaks an unpublished knowledge article", async () => {
    await api.prisma.knowledgeArticle.update({
      where: { slug: "report-suspicious-activity" },
      data: { status: "DRAFT" },
    });

    const response = await message("There is a transaction I did not make on my card.");

    expect(response.status).toBe(200);
    expect(response.body.indicators.map((indicator) => indicator.code)).toEqual([
      "UNKNOWN_TRANSACTION",
    ]);
    for (const reference of [
      ...response.body.actions.map((action) => action.knowledge),
      ...(response.body.indicators[0]?.sources ?? []),
    ]) {
      expect(reference).toEqual({
        slug: "report-suspicious-activity",
        available: false,
        title: null,
        language: null,
        summary: null,
        source: null,
        reviewRequired: false,
      });
    }
    const article = knowledgeArticles.find(
      (candidate) => candidate.slug === "report-suspicious-activity",
    );
    expect(response.text).not.toContain(article?.translations.EN.title);
    expect(response.text).not.toContain("Be Scam Proof");
  });

  it("propagates reviewRequired without dropping the indicator", async () => {
    await api.prisma.knowledgeArticle.update({
      where: { slug: "protect-pin-otp-passwords" },
      data: {
        isTimeSensitive: true,
        lastReviewedAt: new Date(Date.now() - 400 * DAY),
        nextReviewAt: new Date(Date.now() - 10 * DAY),
      },
    });

    const response = await message("Send me your OTP");

    expect(response.body.indicators.map((indicator) => indicator.code)).toEqual([
      "CREDENTIAL_REQUEST",
    ]);
    expect(response.body.indicators[0]?.sources[0]).toMatchObject({
      slug: "protect-pin-otp-passwords",
      available: true,
      reviewRequired: true,
    });
    expect(response.body.riskLevel).toBe("MEDIUM");
  });

  it("resolves all cited knowledge with one batch lookup", async () => {
    const knowledge = api.get(KnowledgeService);
    const batch = vi.spyOn(knowledge, "getPublishedMany");
    const single = vi.spyOn(knowledge, "get");

    await message(
      "Congratulations! Pay the release fee first to receive your prize. Send your OTP and card number now.",
    );

    expect(batch).toHaveBeenCalledTimes(1);
    expect(single).not.toHaveBeenCalled();
  });
});

describe("privacy", () => {
  const AUDIT = "zz_scamshield_write_audit";

  async function publicTables(): Promise<string[]> {
    const rows = await api.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('_prisma_migrations', ${AUDIT})`;
    return rows.map((row) => row.table_name);
  }

  beforeAll(async () => {
    // Statement-level triggers record every INSERT, UPDATE, DELETE or TRUNCATE on every table.
    await api.prisma.$executeRawUnsafe(
      `CREATE TABLE ${AUDIT} (table_name text NOT NULL, operation text NOT NULL)`,
    );
    await api.prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${AUDIT}_record() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO ${AUDIT} VALUES (TG_TABLE_NAME, TG_OP);
        RETURN NULL;
      END $$`);
    for (const table of await publicTables()) {
      await api.prisma.$executeRawUnsafe(
        `CREATE TRIGGER ${AUDIT}_trigger AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "${table}" FOR EACH STATEMENT EXECUTE FUNCTION ${AUDIT}_record()`,
      );
    }
  });

  afterAll(async () => {
    for (const table of await publicTables()) {
      await api.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${AUDIT}_trigger ON "${table}"`);
    }
    await api.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${AUDIT}_record()`);
    await api.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${AUDIT}`);
  });

  beforeEach(async () => {
    await api.prisma.$executeRawUnsafe(`DELETE FROM ${AUDIT}`);
    logger.lines.length = 0;
  });

  it("41. stores nothing: no database write, and the content is in no table", async () => {
    const response = await message(MARKED_SCAM);
    expect(response.status).toBe(200);
    // The evidence (returned to this request only) contains the marker…
    expect(response.text).toContain(MARKER);

    // …but no statement wrote to any table…
    expect(await api.prisma.$queryRawUnsafe(`SELECT * FROM ${AUDIT}`)).toEqual([]);
    // …and the marker is stored nowhere.
    for (const table of await publicTables()) {
      const [row] = await api.prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM "${table}" AS t WHERE to_jsonb(t)::text LIKE $1`,
        `%${MARKER}%`,
      );
      expect(Number(row?.count), table).toBe(0);
    }

    // Control: the audit does record writes made through the application's client.
    await api.prisma.user.create({
      data: { phoneNumber: "+94000000777", preferredLanguage: "EN" },
    });
    expect(await api.prisma.$queryRawUnsafe(`SELECT * FROM ${AUDIT}`)).toEqual([
      { table_name: "users", operation: "INSERT" },
    ]);
  });

  it("42. logs neither the content nor the evidence, also when a request fails", async () => {
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write");

    await message(MARKED_SCAM);
    await analyze({ content: MARKED_SCAM, language: "EN", sourceType: "MESSAGE", extra: true });
    await message(MARKED_SCAM.repeat(200));
    vi.spyOn(api.get(KnowledgeService), "getPublishedMany").mockRejectedValueOnce(
      new Error("simulated knowledge failure"),
    );
    const failed = await message(MARKED_SCAM);
    expect(failed.status).toBe(500);
    expect(failed.text).not.toContain(MARKER);

    // The failure was logged (so the capture works), but without the content or evidence.
    expect(logger.lines.join("\n")).toContain("simulated knowledge failure");
    const everything = [
      ...logger.lines,
      ...stdout.mock.calls.map((call) => String(call[0])),
      ...stderr.mock.calls.map((call) => String(call[0])),
    ].join("\n");
    for (const secret of [MARKER, "482913", "Send your", "account will be closed"]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("44. makes no external network call and never calls Gemini", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const httpSpy = vi.spyOn(http, "request");
    const httpsSpy = vi.spyOn(https, "request");
    const connectSpy = vi.spyOn(net.Socket.prototype, "connect");

    const response = await message(
      "Click https://bit.ly/claim-now or visit http://203.0.113.9/login and send your OTP to prize@example.test",
    );
    expect(response.status).toBe(200);
    expect(response.body.indicators.map((indicator) => indicator.code)).toContain(
      "SUSPICIOUS_LINK",
    );

    // The only HTTP request is the test's own call to the local API.
    const urls = fetchSpy.mock.calls.map(
      (call) => new URL(String(call[0] instanceof Request ? call[0].url : call[0])),
    );
    expect(urls.map((url) => url.hostname)).toEqual(["127.0.0.1"]);
    expect(httpsSpy).not.toHaveBeenCalled();
    expect(httpSpy).not.toHaveBeenCalled();
    // Sockets only to the API itself or the test database.
    const databaseHost = new URL(inject("databaseUrl")).hostname;
    for (const call of connectSpy.mock.calls) {
      const target = call[0] as unknown;
      const host =
        typeof target === "object" && target !== null && "host" in target
          ? String((target as { host?: unknown }).host)
          : typeof call[1] === "string"
            ? call[1]
            : "127.0.0.1";
      expect(["127.0.0.1", "localhost", "::1", databaseHost]).toContain(host);
    }
    expect(model.requests).toEqual([]);
  });

  it("returns evidence only to the request that submitted it", async () => {
    await message(MARKED_SCAM);
    const other = await message(
      "Please transfer Rs. 25,000 to the account number below for the booking.",
    );

    expect(other.text).not.toContain(MARKER);
  });
});

describe("knowledge sources", () => {
  it("every source and action slug exists, is published and has source metadata", async () => {
    const articles = await api
      .get(KnowledgeService)
      .getPublishedMany(SCAM_SHIELD_SOURCE_SLUGS, "EN");

    for (const slug of SCAM_SHIELD_SOURCE_SLUGS) {
      const article = articles.get(slug);
      expect(article, slug).toBeDefined();
      expect(article?.source.url, slug).toMatch(/^https:\/\//u);
      expect(article?.source.publisher, slug).toBe("Central Bank of Sri Lanka");
      expect(article?.title.length, slug).toBeGreaterThan(0);
    }
  });

  it("works without Gemini configured", async () => {
    const withoutGemini = await startTestApi();
    try {
      const response = await withoutGemini.request<ScamShieldAnalysisResponse>("POST", ANALYZE, {
        content: "Send me your OTP",
        language: "EN",
        sourceType: "CALL",
      });
      expect(response.status).toBe(200);
      expect(response.body.indicators.map((indicator) => indicator.code)).toEqual([
        "CREDENTIAL_REQUEST",
      ]);
    } finally {
      await withoutGemini.close();
    }
  });
});
