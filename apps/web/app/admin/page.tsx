import type {
  AnalyticsHealthResponse,
  AnalyticsKnowledgeResponse,
  AnalyticsLanguageResponse,
  AnalyticsLiteracyResponse,
  AnalyticsOverviewResponse,
  AnalyticsReviewQueueResponse,
  AnalyticsScamShieldResponse,
  AnalyticsToolResponse,
  AnalyticsTrendResponse,
} from "@finvoice/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { fetchAnalytics } from "../../lib/admin/analytics-client";
import { adminDashboardConfig } from "../../lib/admin/config";
import { parseDashboardRange, type DashboardRange } from "../../lib/admin/range";
import styles from "./admin.module.css";
import {
  HealthSection,
  KnowledgeSection,
  LanguageSection,
  LiteracySection,
  OverviewCards,
  ReviewQueueSection,
  ScamShieldSection,
  Section,
  ToolSection,
  TrendSection,
} from "./sections";

/**
 * The temporary FinVoice admin dashboard: aggregate, operational analytics only.
 *
 * SECURITY: there is no authentication yet, so the page is DISABLED unless the server has
 * ADMIN_DASHBOARD_ENABLED=true (otherwise it is a plain 404), and it is meant for local
 * development and trusted internal networks only. Everything is rendered on the server: the page
 * has no client components, the server calls the API's internal endpoints with INTERNAL_API_TOKEN
 * in a request header, and the browser receives only the rendered aggregates, never the token and
 * never an internal URL.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin | FinVoice",
  robots: { index: false, follow: false },
};

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminPage({ searchParams }: PageProps) {
  const config = adminDashboardConfig();
  if (!config.enabled) {
    notFound();
  }
  const range = parseDashboardRange(await searchParams, new Date());

  const [overview, trends, languages, knowledge, scamshield, literacy, tools, health, review] =
    await Promise.all([
      fetchAnalytics<AnalyticsOverviewResponse>(config, "overview", range),
      fetchAnalytics<AnalyticsTrendResponse>(config, "trends", range),
      fetchAnalytics<AnalyticsLanguageResponse>(config, "languages", range),
      fetchAnalytics<AnalyticsKnowledgeResponse>(config, "knowledge", range),
      fetchAnalytics<AnalyticsScamShieldResponse>(config, "scamshield", range),
      fetchAnalytics<AnalyticsLiteracyResponse>(config, "literacy", range),
      fetchAnalytics<AnalyticsToolResponse>(config, "tools", range),
      fetchAnalytics<AnalyticsHealthResponse>(config, "health", range),
      fetchAnalytics<AnalyticsReviewQueueResponse>(config, "knowledge-review", null),
    ]);
  const invalidRange = !overview.ok && overview.reason === "invalid_range";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>FinVoice Admin</h1>
        <p className={styles.note}>
          Aggregate, operational analytics. No messages, transcripts, amounts or personal details
          are collected. Days are calendar days in Sri Lanka (Asia/Colombo).
        </p>
      </header>

      <RangeForm range={range} />
      {invalidRange ? (
        <p className={styles.notice} role="alert">
          This date range is not valid. Choose a start date on or before the end date, covering at
          most 366 days.
        </p>
      ) : null}

      {invalidRange ? null : (
        <>
          <Section id="overview" title="Overview" result={overview}>
            {(data) => <OverviewCards data={data} />}
          </Section>
          <Section id="trend" title="Interaction trend" result={trends}>
            {(data) => <TrendSection data={data} />}
          </Section>
          <div className={styles.grid}>
            <Section id="languages" title="Languages" result={languages}>
              {(data) => <LanguageSection data={data} />}
            </Section>
            <Section id="literacy" title="Financial literacy" result={literacy}>
              {(data) => <LiteracySection data={data} />}
            </Section>
            <Section id="scamshield" title="ScamShield" result={scamshield}>
              {(data) => <ScamShieldSection data={data} />}
            </Section>
            <Section id="knowledge" title="Knowledge topics" result={knowledge}>
              {(data) => <KnowledgeSection data={data} />}
            </Section>
          </div>
        </>
      )}
      <Section id="review" title="Knowledge review queue" result={review}>
        {(data) => <ReviewQueueSection data={data} />}
      </Section>
      {invalidRange ? null : (
        <>
          <Section id="tools" title="Tool usage" result={tools}>
            {(data) => <ToolSection data={data} />}
          </Section>
          <Section id="system" title="System: errors and latency" result={health}>
            {(data) => <HealthSection data={data} />}
          </Section>
        </>
      )}
    </main>
  );
}

/** A plain GET form: works without JavaScript, and the range stays in the URL. */
function RangeForm({ range }: { range: DashboardRange }) {
  return (
    <form className={styles.rangeForm} method="get" aria-label="Date range">
      <label>
        Period{" "}
        <select name="range" defaultValue={range.preset}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="custom">Custom range</option>
        </select>
      </label>
      <label>
        From <input type="date" name="from" defaultValue={range.from} />
      </label>
      <label>
        To <input type="date" name="to" defaultValue={range.to} />
      </label>
      <button type="submit">Apply</button>
      <p className={styles.note}>
        Showing {range.from} to {range.to}. The From and To dates apply with “Custom range”.
      </p>
    </form>
  );
}
