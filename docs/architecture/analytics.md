# Analytics and admin dashboard

> **Status:** Step 10. Operational analytics in PostgreSQL (`analytics_events`), recorded by the API and the voice gateway, read through token-protected internal endpoints, and shown on a temporary, **disabled-by-default** admin dashboard (`apps/web`, `/admin`). There is no authentication yet: see [section 19](#19-why-there-is-no-admin-authentication-yet).

## 1. Purpose

Operational visibility for the people running FinVoice:

- how much each feature is used (AI agent, browser voice, calculations, knowledge, ScamShield, literacy);
- in which languages;
- which tools the AI calls;
- how often things fail and how fast they respond;
- which knowledge articles need review.

It is **aggregate operational analytics**, not user analytics. It never tracks people, stores content, profiles users, scores risk or monitors transactions.

## 2. Event model

One table, `analytics_events`, holds one row per operational occurrence:

| Field                | Type                                              | Meaning                                                       |
| -------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| `id`                 | UUID (v7)                                         | Row id, never exposed                                         |
| `event_type`         | enum `analytics_event_type`                       | What happened (section 3)                                     |
| `source`             | enum `WEB`, `VOICE`, `API`, `INTERNAL`            | The channel                                                   |
| `occurred_at`        | timestamptz, UTC                                  | Set by the API when it records the event                      |
| `language`           | existing enum `language` (`SI`, `TA`, `EN`), null | The language of the operation                                 |
| `knowledge_category` | existing enum `knowledge_category`, null          | Knowledge and literacy events only                            |
| `tool_name`          | enum `analytics_tool_name`, null                  | Tool calls and calculations only (a name, never arguments)    |
| `scam_risk_level`    | enum `scam_risk_level`, null                      | ScamShield's final level only                                 |
| `scam_source_type`   | enum `scam_source_type`, null                     | The content type the user selected in ScamShield              |
| `success`            | boolean                                           | Did the operation succeed                                     |
| `duration_ms`        | integer 0–86,400,000, null                        | Operational duration                                          |
| `error_code`         | enum `analytics_error_code`, null                 | A controlled code, only on failures                           |
| `session_id`         | UUID, null                                        | The voice gateway's random connection id, voice sessions only |
| `created_at`         | timestamptz                                       | Insert time                                                   |

All values come from existing controlled lists:

- languages, knowledge categories and the tool names (`AGENT_TOOL_NAMES` + `USER_CONTEXT_TOOL_NAMES`);
- the ScamShield levels and content types (from `@finvoice/scam-shield`);
- the API and voice error codes, plus the four tool-execution failures.

The contract is `analyticsEventSchema` in [`packages/contracts/src/analytics.ts`](../../packages/contracts/src/analytics.ts). CHECK constraints mirror its rules, so each optional field is set only where it has a meaning:

- ScamShield fields only on `SCAM_ANALYSIS`;
- a tool name only on tool calls and calculations;
- a category only on knowledge and literacy events;
- a session id only on voice sessions;
- an error code only on failures;
- the duration bounds.

## 3. Event types

| Event type                 | Recorded by                                      | Fields                                                |
| -------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| `AGENT_REQUEST`            | `AgentService` (`POST /api/v1/agent/chat`)       | language, success, duration, error code               |
| `AGENT_TOOL_CALL`          | `AgentService`, per tool execution               | tool name, language, success, duration                |
| `VOICE_SESSION`            | voice gateway, at session end, via ingestion     | language, duration, success, error code, session id   |
| `VOICE_TOOL_CALL`          | API `/internal/voice/tools/execute`              | tool name, language, success, duration                |
| `KNOWLEDGE_SEARCH`         | `KnowledgeService.list` for the public API       | language, category filter, success, duration          |
| `KNOWLEDGE_ARTICLE_VIEW`   | `KnowledgeService.get` for the public API        | language, article category, success, duration         |
| `SCAM_ANALYSIS`            | `ScamShieldService`                              | language, content type, risk level, success, duration |
| `LITERACY_TOPIC_STARTED`   | `FinancialLiteracyProgressService`               | topic (category)                                      |
| `LITERACY_TOPIC_COMPLETED` | `FinancialLiteracyProgressService`               | topic (category)                                      |
| `CALCULATION`              | `CalculationsService` (`/api/v1/calculations/*`) | calculator (tool name), success, duration             |

Each event describes one operation, with some exclusions:

- Knowledge events are recorded only for the public knowledge API. The agent's knowledge lookups are counted as tool calls, not twice.
- Literacy events are recorded only for real status changes. Repeated `start` (activity) and repeated `complete` add nothing.

## 4. Privacy rules

1. Analytics store **operational metadata only**: the fields in section 2 and nothing else.
2. There is **no user id**, so analytics cannot follow or profile a person. A user-level audit trail would be a separate, explicit design.
3. There is **no free text and no JSON metadata column**. A generic `metadata JSONB` field would invite storing content by accident, so every stored value is a typed enum, a boolean, a bounded integer or a random UUID.
4. **Strict schemas.** Unknown fields are rejected (400), never silently dropped. The API validates every event again before it is stored, whoever produced it.
5. **No tracking** of IP addresses, user agents, cookies, device or browser ids, or fingerprints.
6. **No external analytics services.** Everything stays in FinVoice's PostgreSQL.

## 5. Fields stored

Only the columns in section 2. `occurred_at` comes from the API's clock, never from a client.

## 6. Fields explicitly forbidden

Never stored, and rejected if sent:

- **Conversation content:** user messages, voice transcripts, model transcripts or answers, audio and microphone data.
- **Money:** financial amounts, income, expenses and goal amounts.
- **Identifiers:** phone numbers and account or card numbers.
- **Secrets:** OTPs, PINs, passwords and banking credentials.
- **ScamShield input:** the submitted text, evidence snippets, extracted phrases and URLs.
- **Knowledge:** search queries, article slugs and article bodies.
- **AI internals:** Gemini prompts and responses, and tool arguments and results.
- **Diagnostics:** error messages, stack traces and provider errors.
- **Tracking data:** user ids, IP addresses and user agents.

Tests send each of these as an extra field to the ingestion endpoint and to the contract, and expect a 400 or a rejection with nothing stored. Instrumentation tests check that a marker from every request, and its amounts, query, slug and user, appear in no stored row.

## 7. Event instrumentation

```text
Feature service ──record()──▶ AnalyticsRecorder ──▶ analytics_events (PostgreSQL)
      (validates again, sets occurred_at, fire-and-forget)

Voice gateway ──POST /internal/analytics/events──▶ AnalyticsService.ingest ──▶ AnalyticsRecorder

Admin dashboard (browser) ──▶ Next.js server ──GET /internal/admin/analytics/*──▶ AnalyticsService ──▶ PostgreSQL
                                   (INTERNAL_API_TOKEN, server-side only)
```

- **Module structure:** feature services depend only on the abstract `AnalyticsRecorder`, provided by the global `AnalyticsRecorderModule`, which depends only on the database. The read side (`AnalyticsModule`: `AnalyticsService` and the internal controllers) depends on `KnowledgeService` for the review queue. Nothing depends on the read side, so there are no circular modules.
- **Measurement:** instrumentation sits at service boundaries. Durations are measured with `performance.now()` around the operation.
- **Voice tool calls** are recorded where they run (the API's internal tool endpoint), so the gateway only reports whole sessions.
- **Ingestion endpoint:** it accepts only event types the API cannot observe itself (today `VOICE_SESSION`). Anything else would be double counting or forgery.

## 8. Analytics aggregation

The read endpoints return aggregates only: counts, shares, averages and percentiles. There is no raw-event endpoint, and no event rows or ids are returned.

- **Where the work happens:** everything is computed in PostgreSQL. Counts use Prisma `groupBy`, so no event rows are loaded into Node.js.
- **Raw SQL, and why:** it is used only for:
  - percentiles (`PERCENTILE_CONT`), which Prisma cannot express;
  - grouping by the local calendar day (`AT TIME ZONE`).

  Every value in that SQL is a bound parameter, and the event-type lists are server constants.

- **Interactions** are the user-facing operations: agent requests, voice sessions, ScamShield analyses, calculations, knowledge searches and article views. Tool calls and literacy updates are not interactions.
- **Percentages** are strings with exactly two decimals ("40.32"), computed with integer arithmetic on counts and rounded half up. They are `null` when the total is zero. This is analytics arithmetic, unrelated to the money rules.

## 9. Date ranges

Every read endpoint except the review queue takes `?from=YYYY-MM-DD&to=YYYY-MM-DD`: calendar dates, both inclusive.

- Timestamps are not accepted.
- `from` must not be after `to`.
- At most **366** days.
- With no dates, the range is the **30 calendar days ending today**. With only `from`, it runs up to today (or `from`, if later). With only `to`, it is the 30 days ending then.
- The trend endpoint returns one entry per day of the range, with zeros for days without events, so the dashboard never has to guess missing days.

## 10. UTC storage

`occurred_at` is `timestamptz`, set by the API from its own clock. Clients cannot send timestamps (unknown field, 400). A voice session is therefore recorded when the API receives it, which is just after the session ends.

## 11. Asia/Colombo dashboard grouping

Dashboard days are calendar days in **Asia/Colombo** (UTC+05:30, `ANALYTICS_TIMEZONE`), where FinVoice's users are. One function, `resolveRange`, turns every date range into UTC bounds `[start, end)`, so every endpoint uses the same day boundaries.

The trend query groups by `occurred_at AT TIME ZONE 'Asia/Colombo'`. A test checks both edges of a day: 18:29:59.999 UTC still belongs to the same local day, and 18:30:00 UTC starts the next.

## 12. Latency metrics

Durations are integer milliseconds from 0 to 24 hours. Negative, fractional or larger values are rejected by the contract and by a CHECK constraint.

- **Overview:** average and 95th percentile of the response time of request/response interactions (agent, ScamShield, calculations, knowledge). Voice-session durations are conversation lengths, not response times.
- **Health:** average, p50 and p95 for each event type.

Percentiles are continuous (`PERCENTILE_CONT`) and rounded to whole milliseconds.

## 13. Sample-size handling

- `sampleSize` is always returned.
- With **fewer than 5** observations (`ANALYTICS_MIN_PERCENTILE_SAMPLES`), `p50Ms`/`p95Ms` (and the overview's `p95ResponseMs`) are `null`: a percentile of three requests is not meaningful.
- The average is returned from 1 observation, and is `null` with none.
- The dashboard shows "—" and says why.

## 14. Retention

Events are kept for `ANALYTICS_RETENTION_DAYS` days: default **90**, allowed 1–3650. Never forever.

## 15. Cleanup

The cleanup command deletes events that occurred more than `ANALYTICS_RETENTION_DAYS` days before now:

```sh
pnpm analytics:cleanup                                  # development (reads the root .env)
node apps/api/dist/analytics/analytics-cleanup.cli.js   # a built deployment, e.g. from a scheduler
```

- It uses the `analyticsEvent` model's `deleteMany` only, so it cannot touch any other table. A test checks that the row counts of every other table are unchanged.
- It prints only the number of deleted events and the cutoff, never event contents. On failure it prints the error class only.
- It is idempotent: a second run deletes nothing.
- It **never runs at API startup**. Scheduling it is left to the future deployment system.

## 16. Analytics failure behaviour

Analytics are never a critical dependency:

- **Never throws, never waits.** `AnalyticsRecorder.record` is synchronous for the caller and starts the database write in the background. If the event is invalid or the write fails, the feature's response is unaffected.
- **Safe logging.** A failure is logged as `Analytics recording failed (<category>)`, where the category is a Prisma error code or an error class, never the event or the error text. Failures are counted (`recordingFailuresSinceStart` on the health endpoint) and not retried.
- **Voice gateway.** It sends its session event fire-and-forget. A failure is logged as `analytics recording failed` with a failure kind, and voice continues.
- **Duplicates.** Retries or reconnects can occasionally record an event twice. Exactly-once processing is deliberately not implemented (section 21).
- **Shutdown.** On shutdown the API waits for writes in progress. A future queue can replace direct writes if volume requires it; Redis is not used now.

Integration tests rename the `analytics_events` table away and check that ScamShield, calculations, knowledge, the agent and literacy all still succeed. The voice gateway has the equivalent test.

## 17. Internal API

Every analytics endpoint sits **outside `/api/v1`** and is protected by `INTERNAL_API_TOKEN`, sent in the `x-finvoice-internal-token` header: the same token and guard as the other internal endpoints. There is no second token.

- Missing or wrong token: `401`, checked before validation.
- No token configured on the API: `503`.

| Method | Path                                         | Purpose                                                           |
| ------ | -------------------------------------------- | ----------------------------------------------------------------- |
| `POST` | `/internal/analytics/events`                 | Ingest one event (voice gateway); `202 {"status":"accepted"}`     |
| `GET`  | `/internal/admin/analytics/overview`         | Interactions by feature, success rate, average and p95 response   |
| `GET`  | `/internal/admin/analytics/trends`           | One row per day with counts per feature                           |
| `GET`  | `/internal/admin/analytics/languages`        | Counts and shares for SI, TA, EN                                  |
| `GET`  | `/internal/admin/analytics/knowledge`        | Searches, views, category usage, languages, knowledge-base state  |
| `GET`  | `/internal/admin/analytics/scamshield`       | Total, success rate, risk levels, content types, languages        |
| `GET`  | `/internal/admin/analytics/literacy`         | Topics started/completed by category; profile counts by level     |
| `GET`  | `/internal/admin/analytics/tools`            | Calls per tool (agent/voice), failures; only tools that were used |
| `GET`  | `/internal/admin/analytics/health`           | Failures, error codes, latency per event type, recording failures |
| `GET`  | `/internal/admin/analytics/knowledge-review` | Knowledge review queue (current state)                            |

- **Knowledge review queue:** read directly from the knowledge tables through `KnowledgeService`, which stays the only source of truth. It is never stored in analytics. Buckets are `OVERDUE`, `DUE_WITHIN_7_DAYS`, `DUE_WITHIN_30_DAYS` and `LATER`. `reviewRequired` is true for time-sensitive articles that are overdue. The queue is read-only: knowledge editing waits for authentication.
- **Literacy profile counts:** read from the literacy tables, counts only.
- **Responses:** sent with `Cache-Control: no-store`. They never contain ids, session ids, users or content.
- **Details:** request and response shapes are in [domain-api.md](../api/domain-api.md#internal-analytics-endpoints-internal-not-part-of-apiv1).

## 18. Dashboard security

The dashboard is at `/admin` in the web app:

```text
Browser ──▶ Next.js server (server components) ──INTERNAL_API_TOKEN──▶ /internal/admin/analytics/*
```

- **Disabled by default.** Unless the web server has `ADMIN_DASHBOARD_ENABLED=true`, `/admin` is a plain 404 and the API is never called. Invalid settings also disable it. The 404 comes from a Next.js proxy (`apps/web/proxy.ts`) before anything renders, because the app's loading boundary would otherwise stream a `200` before the page can say "not found". The page's own `notFound()` check remains as a second line of defence.
- **Server-side only.**
  - The page is rendered entirely on the server and has **no client components**.
  - `INTERNAL_API_TOKEN` and `INTERNAL_API_URL` are server-only variables, never `NEXT_PUBLIC_*`.
  - The browser never receives the token or an internal URL, and never calls `/internal/*`.
  - The server reads these settings from its environment, then from the root `.env` (those three keys only), **at request time**, never during `next build`. A clean build was scanned: the token value appears nowhere in the build output or its cache. Next's `env` option, which would inline values into bundles, is not used.
- **Tests.** They render the page and check:
  - the token and the internal address never appear in the HTML;
  - the admin code contains no `"use client"`;
  - no `NEXT_PUBLIC_*` variable carries a token;
  - only the server-side admin library reads the token.
- **Aggregates only.** No names, phone numbers, user ids, profiles, goals, scam messages, search queries, transcripts, tool arguments or amounts. Article titles appear only in the review queue.
- **Failure display.**
  - A failed section shows "Analytics data is temporarily unavailable." without details, and the other sections still render.
  - An invalid range shows a short explanation.
  - Empty data shows empty-state messages, never broken charts.
- **Accessibility.**
  - Headings for every section.
  - Labelled controls, and a plain GET form that works without JavaScript.
  - Charts are decorative (`aria-hidden`), with text summaries and data tables.
  - Nothing is conveyed by colour alone: risk levels are labelled.
  - The layout is responsive.
- **`noindex`.** The page sets `noindex`.

## 19. Why there is no admin authentication yet

Authentication and authorisation do not exist yet in FinVoice (they are a later step), and inventing a password or token login for the dashboard would be a weak, temporary access control. Until then:

- The internal API is protected by the service token, which only servers hold.
- The dashboard is disabled by default and meant only for **local development or a trusted internal network**.
- **When enabled, the dashboard itself has no login.** Anyone who can reach the web server's `/admin` can see the aggregates. It is **not production-safe** until authentication exists.

## 20. Future authentication integration

When authentication and authorisation arrive:

- the dashboard will require an authenticated administrator role, checked on the server before any data is fetched;
- the admin read endpoints can move behind the same authorisation (or stay internal, called by the web server with a service identity);
- `ADMIN_DASHBOARD_ENABLED` can then become a feature flag rather than a safety switch.

A user-level audit trail, if ever needed, would be a separate design with its own privacy review, not an extension of these aggregate events.

## 21. Approximate-count limitations

Analytics are operational and observational, not accounting:

- a retried request or reconnected gateway can record an event twice;
- an event whose write failed is lost (counted in `recordingFailuresSinceStart`, which resets on restart);
- a voice session is counted when it ends, so a session still running at the end of a range falls into a later day;
- a voice session that never started (no `start_session`) is not counted.

Counts can therefore be approximate in rare cases. They are never used for billing, users or decisions about individuals.
