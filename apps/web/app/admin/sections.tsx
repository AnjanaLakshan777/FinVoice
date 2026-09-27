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
import type { ReactNode } from "react";

import type { AnalyticsResult } from "../../lib/admin/analytics-client";
import styles from "./admin.module.css";
import {
  BUCKET_LABELS,
  CATEGORY_LABELS,
  EVENT_TYPE_LABELS,
  formatCount,
  formatDate,
  formatMs,
  formatPercentage,
  LANGUAGE_LABELS,
  RISK_LABELS,
  SOURCE_TYPE_LABELS,
  TOOL_LABELS,
} from "./format";

export const UNAVAILABLE_MESSAGE = "Analytics data is temporarily unavailable.";

/** A dashboard section: its data, or a calm message when that one request failed. */
export function Section<T>(props: {
  id: string;
  title: string;
  result: AnalyticsResult<T>;
  children: (data: T) => ReactNode;
}) {
  return (
    <section className={styles.section} aria-labelledby={props.id}>
      <h2 id={props.id}>{props.title}</h2>
      {props.result.ok ? (
        props.children(props.result.data)
      ) : (
        <p className={styles.notice} role="status">
          {UNAVAILABLE_MESSAGE}
        </p>
      )}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}

type Bar = { label: string; value: number; detail?: string };

/**
 * Horizontal bars. Every bar has its label and number as text; the bar itself is decoration
 * (aria-hidden), so nothing is conveyed by length or colour alone.
 */
function BarList({ items, label }: { items: Bar[]; label: string }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className={styles.bars} aria-label={label}>
      {items.map((item) => (
        <li key={item.label} className={styles.barRow}>
          <span className={styles.barLabel}>{item.label}</span>
          <span className={styles.barValue}>
            {formatCount(item.value)}
            {item.detail === undefined ? null : ` (${item.detail})`}
          </span>
          <span className={styles.barTrack} aria-hidden="true">
            <span
              className={styles.barFill}
              style={{ width: `${String((item.value / max) * 100)}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function OverviewCards({ data }: { data: AnalyticsOverviewResponse }) {
  const cards: [string, string][] = [
    ["Total interactions", formatCount(data.interactions.total)],
    ["Voice sessions", formatCount(data.interactions.voice)],
    ["AI agent requests", formatCount(data.interactions.agent)],
    ["ScamShield analyses", formatCount(data.interactions.scamshield)],
    ["Calculations", formatCount(data.interactions.calculations)],
    ["Success rate", formatPercentage(data.successRate)],
    ["Average response", formatMs(data.averageResponseMs)],
    ["P95 response", formatMs(data.p95ResponseMs)],
  ];
  return (
    <>
      <dl className={styles.cards}>
        {cards.map(([label, value]) => (
          <div key={label} className={styles.card}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.note}>
        Knowledge requests: {formatCount(data.interactions.knowledge)}. Response times cover{" "}
        {formatCount(data.responseSampleSize)} requests
        {data.p95ResponseMs === null && data.responseSampleSize > 0
          ? "; the 95th percentile needs at least 5"
          : ""}
        .
      </p>
    </>
  );
}

export function TrendSection({ data }: { data: AnalyticsTrendResponse }) {
  const total = data.data.reduce((sum, day) => sum + day.total, 0);
  if (total === 0) {
    return <Empty>No interactions in this period.</Empty>;
  }
  const busiest = data.data.reduce((best, day) => (day.total > best.total ? day : best));
  const max = Math.max(1, ...data.data.map((day) => day.total));
  return (
    <>
      <p>
        {formatCount(total)} interactions over {formatCount(data.data.length)} days. Busiest day:{" "}
        {busiest.date} ({formatCount(busiest.total)}).
      </p>
      <div className={styles.columns} aria-hidden="true">
        {data.data.map((day) => (
          <span
            key={day.date}
            className={styles.column}
            style={{ height: `${String(Math.max(2, (day.total / max) * 100))}%` }}
            title={`${day.date}: ${String(day.total)}`}
          />
        ))}
      </div>
      <details className={styles.details}>
        <summary>Daily numbers</summary>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">AI agent</th>
                <th scope="col">Voice</th>
                <th scope="col">ScamShield</th>
                <th scope="col">Calculations</th>
                <th scope="col">Knowledge</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{day.date}</th>
                  <td>{day.agentRequests}</td>
                  <td>{day.voiceSessions}</td>
                  <td>{day.scamAnalyses}</td>
                  <td>{day.calculations}</td>
                  <td>{day.knowledgeRequests}</td>
                  <td>{day.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

export function LanguageSection({ data }: { data: AnalyticsLanguageResponse }) {
  if (data.total === 0) {
    return <Empty>No language data in this period.</Empty>;
  }
  return (
    <BarList
      label="Events by language"
      items={data.data.map((entry) => ({
        label: LANGUAGE_LABELS[entry.language],
        value: entry.count,
        detail: formatPercentage(entry.percentage),
      }))}
    />
  );
}

export function LiteracySection({ data }: { data: AnalyticsLiteracyResponse }) {
  const active = data.byCategory.filter((entry) => entry.started + entry.completed > 0);
  return (
    <>
      <p>
        Topics started: {formatCount(data.topicsStarted)}. Topics completed:{" "}
        {formatCount(data.topicsCompleted)}.
      </p>
      {active.length === 0 ? (
        <Empty>No literacy progress in this period.</Empty>
      ) : (
        <div className={styles.tableWrap}>
          <table>
            <caption>Topic progress in this period</caption>
            <thead>
              <tr>
                <th scope="col">Topic</th>
                <th scope="col">Started</th>
                <th scope="col">Completed</th>
              </tr>
            </thead>
            <tbody>
              {active.map((entry) => (
                <tr key={entry.category}>
                  <th scope="row">{CATEGORY_LABELS[entry.category]}</th>
                  <td>{entry.started}</td>
                  <td>{entry.completed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.note}>
        Literacy profiles now: {formatCount(data.profiles.total)} (
        {formatCount(data.profiles.assessed)} assessed, {formatCount(data.profiles.unassessed)} not
        yet assessed).{" "}
        {data.profiles.levels
          .map(
            (level) =>
              `${level.level.charAt(0)}${level.level.slice(1).toLowerCase()}: ${String(level.count)}`,
          )
          .join(", ")}
        .
      </p>
    </>
  );
}

export function ScamShieldSection({ data }: { data: AnalyticsScamShieldResponse }) {
  if (data.total === 0) {
    return <Empty>No ScamShield analyses in this period.</Empty>;
  }
  return (
    <>
      <p>
        Analyses: {formatCount(data.total)}. Completed: {formatPercentage(data.successRate)}. Risk
        levels are indicator-based, not verdicts.
      </p>
      <h3>Risk levels</h3>
      <BarList
        label="Analyses by risk level"
        items={data.riskLevels.map((entry) => ({
          label: RISK_LABELS[entry.riskLevel],
          value: entry.count,
          detail: formatPercentage(entry.percentage),
        }))}
      />
      <h3>Content checked</h3>
      <BarList
        label="Analyses by content type"
        items={data.sourceTypes
          .filter((entry) => entry.count > 0)
          .map((entry) => ({ label: SOURCE_TYPE_LABELS[entry.sourceType], value: entry.count }))}
      />
    </>
  );
}

export function KnowledgeSection({ data }: { data: AnalyticsKnowledgeResponse }) {
  const used = data.categories.filter((entry) => entry.count > 0);
  return (
    <>
      <p>
        Searches: {formatCount(data.searches)}. Article views: {formatCount(data.articleViews)}.
        Published articles: {formatCount(data.articles.published)} (
        {formatCount(data.articles.translated)} with a Sinhala or Tamil translation).
      </p>
      {used.length === 0 ? (
        <Empty>No topic usage in this period.</Empty>
      ) : (
        <BarList
          label="Knowledge use by topic"
          items={used.map((entry) => ({
            label: CATEGORY_LABELS[entry.category],
            value: entry.count,
            detail: formatPercentage(entry.percentage),
          }))}
        />
      )}
    </>
  );
}

export function ReviewQueueSection({ data }: { data: AnalyticsReviewQueueResponse }) {
  const due = data.articles.filter((article) => article.bucket !== "LATER");
  return (
    <>
      <dl className={styles.inlineStats}>
        {(["OVERDUE", "DUE_WITHIN_7_DAYS", "DUE_WITHIN_30_DAYS", "LATER"] as const).map(
          (bucket) => (
            <div key={bucket}>
              <dt>{BUCKET_LABELS[bucket]}</dt>
              <dd>{formatCount(data.buckets[bucket])}</dd>
            </div>
          ),
        )}
      </dl>
      <p className={styles.note}>
        {formatCount(data.timeSensitiveArticles)} time-sensitive articles;{" "}
        {formatCount(data.reviewRequired)} require review now.
      </p>
      {due.length === 0 ? (
        <Empty>No articles are due for review within 30 days.</Empty>
      ) : (
        <div className={styles.tableWrap}>
          <table>
            <caption>Articles due for review</caption>
            <thead>
              <tr>
                <th scope="col">Article</th>
                <th scope="col">Status</th>
                <th scope="col">Next review</th>
              </tr>
            </thead>
            <tbody>
              {due.map((article) => (
                <tr key={article.slug}>
                  <th scope="row">
                    {article.title}
                    {article.isTimeSensitive ? " (time-sensitive)" : ""}
                  </th>
                  <td>{BUCKET_LABELS[article.bucket]}</td>
                  <td>{formatDate(article.nextReviewAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function ToolSection({ data }: { data: AnalyticsToolResponse }) {
  if (data.data.length === 0) {
    return <Empty>No tool calls in this period.</Empty>;
  }
  return (
    <div className={styles.tableWrap}>
      <table>
        <caption>Tool calls by the AI agent and voice (names only)</caption>
        <thead>
          <tr>
            <th scope="col">Tool</th>
            <th scope="col">Calls</th>
            <th scope="col">AI agent</th>
            <th scope="col">Voice</th>
            <th scope="col">Failed</th>
          </tr>
        </thead>
        <tbody>
          {data.data.map((tool) => (
            <tr key={tool.toolName}>
              <th scope="row">{TOOL_LABELS[tool.toolName]}</th>
              <td>{tool.calls}</td>
              <td>{tool.agentCalls}</td>
              <td>{tool.voiceCalls}</td>
              <td>{tool.failed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HealthSection({ data }: { data: AnalyticsHealthResponse }) {
  const active = data.byEventType.filter((entry) => entry.total > 0);
  return (
    <>
      <p>
        {formatCount(data.totalEvents)} events, {formatCount(data.failedEvents)} failed (
        {formatPercentage(data.failureRate)}). Events the API could not record since it started:{" "}
        {formatCount(data.recordingFailuresSinceStart)}.
      </p>
      {active.length === 0 ? (
        <Empty>No operational events in this period.</Empty>
      ) : (
        <div className={styles.tableWrap}>
          <table>
            <caption>Errors and latency by operation (percentiles need at least 5 samples)</caption>
            <thead>
              <tr>
                <th scope="col">Operation</th>
                <th scope="col">Total</th>
                <th scope="col">Failed</th>
                <th scope="col">Average</th>
                <th scope="col">P50</th>
                <th scope="col">P95</th>
              </tr>
            </thead>
            <tbody>
              {active.map((entry) => (
                <tr key={entry.eventType}>
                  <th scope="row">{EVENT_TYPE_LABELS[entry.eventType]}</th>
                  <td>{entry.total}</td>
                  <td>{entry.failed}</td>
                  <td>{formatMs(entry.latency.averageMs)}</td>
                  <td>{formatMs(entry.latency.p50Ms)}</td>
                  <td>{formatMs(entry.latency.p95Ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.errorCodes.length === 0 ? null : (
        <p className={styles.note}>
          Error codes:{" "}
          {data.errorCodes.map((entry) => `${entry.errorCode} (${String(entry.count)})`).join(", ")}
          .
        </p>
      )}
    </>
  );
}
