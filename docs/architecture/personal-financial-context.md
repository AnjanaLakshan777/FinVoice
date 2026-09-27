# Personal financial context

> **Status:** Step 8. The data model, services and a token-protected internal API exist. No public endpoint, public agent or browser voice session can read or change personal context: there is no authentication yet (see [§17](#17-security-limitations-before-authentication)).

## 1. Purpose

FinVoice already explains general financial topics (Steps 5–7). To personalise those explanations later (for example "you told me your monthly expenses are Rs. 100,000"), a trusted part of the system must be able to read a small, safe summary of one user's situation:

- the user's financial profile (monthly income and expenses, if provided);
- their **active** financial goals;
- their financial-literacy **learning level** and their progress per literacy topic;
- which details are still missing.

This step builds that layer: two new tables, services, a read-only aggregation (`FinancialContextService`), a minimal token-protected internal API, and tool definitions for a future authenticated agent. Nothing here calculates, recommends or infers anything.

## 2. `FinancialLiteracyProfile`

One row per user (`financial_literacy_profiles`, unique `user_id`, deleted with the user).

| Column               | Meaning                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `level`              | `BEGINNER`, `DEVELOPING` or `CONFIDENT`. A **learning level**, not a rating of intelligence or competence. Default `BEGINNER`. |
| `assessment_version` | Identifies the assessment definition used, e.g. `"1"`. Default `"1"`. Not a versioning system, just a label.                   |
| `assessed_at`        | When a formal assessment produced the level. **Null means "no formal assessment completed yet"**.                              |

- **Default without a row.** A user without a row is treated as `BEGINNER`, version `"1"`, `assessedAt: null`. Reading the context never creates rows. `createOrGetProfile` creates the same default row when a caller needs one, and it never sets `assessedAt`: creating a row is not an assessment.
- **No numeric score.** There is no 0–100 literacy score, AI confidence, "knowledge score" or similar.

## 3. `FinancialLiteracyTopicProgress`

One row per user and topic (`financial_literacy_topic_progress`, unique `(user_id, topic)`, deleted with the user).

- **Topics** are the knowledge-base categories (`SAVING`, `BUDGETING`, `BORROWING`, `DIGITAL_FINANCE`, `CONSUMER_PROTECTION`, `SCAMS`, `DEPOSIT_PROTECTION`, `GENERAL_FINANCIAL_LITERACY`). The column reuses the existing `knowledge_category` database enum, so topics and content always share one list.
- **Per topic, not per article.** Progress is recorded per topic because articles change over time.
- **Columns:** `status` (`NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`), `started_at`, `completed_at`, `last_activity_at`.
- **Missing rows.** A topic without a row is `NOT_STARTED`; rows are created on the first start or completion.

## 4. Context aggregation

`FinancialContextService.getFinancialContext(userId)` ([apps/api/src/financial-context](../../apps/api/src/financial-context)) reads through the existing domain services (`UsersService`, `FinancialProfilesService`, `FinancialGoalsService`) and the new literacy services. It never reads tables directly and never writes.

```json
{
  "user": { "preferredLanguage": "SI", "timezone": "Asia/Colombo" },
  "profile": { "monthlyIncome": "150000.00", "monthlyExpenses": "100000.00", "currency": "LKR" },
  "goals": [
    {
      "type": "EMERGENCY_FUND",
      "name": "Emergency Fund",
      "targetAmount": "300000.00",
      "currentAmount": "50000.00",
      "targetDate": "2027-06-30",
      "currency": "LKR",
      "status": "ACTIVE"
    }
  ],
  "moreActiveGoals": false,
  "literacy": {
    "level": "BEGINNER",
    "assessmentVersion": "1",
    "assessedAt": null,
    "topics": [
      { "topic": "SAVING", "status": "IN_PROGRESS", "lastActivityAt": "2026-09-27T08:00:00.000Z" }
    ]
  },
  "completeness": { "profileComplete": true, "missingFields": [] }
}
```

- **`profile`** is `null` when the user has no financial profile. Inside it, a `null` amount means "not provided", which is different from `"0.00"`.
- **`goals`** contains ACTIVE goals only, soonest target date first (goals without a date last), at most 20; `moreActiveGoals` says whether more exist. Completed and cancelled goals are never included.
- **`literacy.topics`** lists only stored progress. Nothing is inferred from chats, tool calls, model confidence or tone.
- **Money** stays the exact decimal strings the domain services return. The service calculates nothing: no EMI, total interest, savings rate, affordability or recommendations. Those belong to the finance engine (§15) or future, explicitly specified services.
- **Queries.** Five per request whatever the data size, and no N+1: the user first (404 if unknown), then the profile, active goals (one query with `take: 21`, on the existing `(user_id, status, target_date)` index), literacy profile and literacy progress in parallel.
- **Literacy only.** `getLiteracyContext(userId)` returns the level and stored topic progress, including `startedAt` and `completedAt`.

## 5. Profile completeness

A deterministic check of three stable fields, reported in this order:

| Field             | Missing when                                  |
| ----------------- | --------------------------------------------- |
| `monthlyIncome`   | no financial profile, or its income is null   |
| `monthlyExpenses` | no financial profile, or its expenses is null |
| `activeGoal`      | the user has no ACTIVE goal                   |

`profileComplete` is true when nothing is missing. `"0.00"` counts as provided. The domain allows partial information, so an incomplete profile is normal, not an error.

## 6. Privacy minimisation

The context is built by an explicit field-by-field mapper ([financial-context.mapper.ts](../../apps/api/src/financial-context/financial-context.mapper.ts)); anything not listed there cannot leak.

- **Included:** preferred language, timezone, income, expenses, currency, active goals (type, name, amounts, target date, currency, status), literacy level, assessment version and date, and stored topic status with last activity.
- **Excluded:**
  - all database ids, including the user id;
  - phone number, display name and account status;
  - record `createdAt`/`updatedAt`;
  - completed and cancelled goals;
  - chats, transcripts and knowledge search history;
  - credentials, cards, PINs, OTPs and bank logins, which FinVoice does not store anyway.

Tests check the response for ids, phone number, display name and the internal token.

## 7. Internal API

INTERNAL and token-protected, outside the public `/api/v1` API (all `/internal/*` routes are excluded from the version prefix):

| Method | Path                                                      | Purpose                                                           |
| ------ | --------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET`  | `/internal/users/:userId/financial-context`               | The minimised financial context (§4)                              |
| `GET`  | `/internal/users/:userId/literacy-context`                | Level and stored topic progress with start/completion             |
| `PUT`  | `/internal/users/:userId/literacy/profile`                | Explicit level change: `{ level, assessmentVersion, assessedAt }` |
| `POST` | `/internal/users/:userId/literacy/topics/:topic/start`    | Record that the user started a topic (no body)                    |
| `POST` | `/internal/users/:userId/literacy/topics/:topic/complete` | Record that the user completed a topic (no body)                  |

- **Errors:**
  - `401` for a missing, wrong or malformed token, checked first, before validation or any database access;
  - `503` if the API has no token configured;
  - `400` for an invalid user id, topic or body;
  - `404` for an unknown user;
  - `409` for a disallowed transition.
- **Bodies.** Error bodies use the standard format and contain no user data, ids, stack traces or secrets.
- **Deliberately small.** There is no generic user CRUD and no way to change income, expenses, goals or phone numbers here.

## 8. `INTERNAL_API_TOKEN`

The same server-side token as the Step 7 voice gateway uses; there is no second token or second mechanism.

- **Header.** Callers send it in `x-finvoice-internal-token`, the convention Step 7 established.
- **Comparison.** The guard ([internal-token.guard.ts](../../apps/api/src/common/internal-token.guard.ts)) compares SHA-256 digests with `timingSafeEqual`, so neither the token's length nor its content leaks through timing.
- **Never exposed.** The token is never logged or returned; a test captures stdout and stderr during rejected requests to check this. It is at least 32 characters, never a `NEXT_PUBLIC_*` value, and never the Gemini key.
- **Unknown users.** Without the token, a request for a random user id gets `401`, not `404`, so the endpoint does not reveal whether a user exists.

## 9. Why the public agent cannot accept `userId`

`POST /api/v1/agent/chat` has no authentication. If it accepted a `userId`, anyone could ask about anyone's income and goals by guessing or collecting UUIDs: an insecure direct object reference (IDOR). Its request schema stays strict (`message`, `language` only), so a `userId` field is rejected with `400` before anything runs; a regression test sends one and checks that no data is returned. The public agent's tool allowlist does not contain the user-context tools.

## 10. Why browser voice cannot trust `userId`

The browser is not authenticated, and any value it sends can be forged. The voice protocol's `start_session` accepts only `language`; a `userId` (or any other field) makes the message invalid. This is tested at the contract and at the gateway. The voice gateway has no route to personal context.

## 11. Literacy-level rules

- **Only explicit application logic changes the level:** a formal assessment, or an authorised system or human update through `updateProfileLevel` (internal `PUT`). The model never decides "the user is a beginner", and conversations never change the level.
- **All fields required.** `level`, `assessmentVersion` and `assessedAt` must all be sent, so nothing changes by omission. `assessedAt` is when the assessment happened, or `null` when the change is not an assessment result.
- **Validation.** `assessedAt` must not be in the future (service check; a CHECK constraint cannot use `now()`). `assessmentVersion` is a short identifier (`^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$`, also a CHECK constraint).
- **Levels are not labels in answers.** Future personalisation must not tell users "you are a beginner, so…".

## 12. Topic progression

```text
NOT_STARTED (no row) ──start──▶ IN_PROGRESS ──complete──▶ COMPLETED
NOT_STARTED (no row) ─────────────complete────────────────▶ COMPLETED
```

- **Server-set timestamps.** All timestamps come from the server clock; clients cannot send `startedAt`, `completedAt`, `lastActivityAt`, `createdAt` or `updatedAt` (the POST routes take no body, and anything sent is ignored).
- **Idempotent calls.** `start` on an IN_PROGRESS topic only records activity (`lastActivityAt`). `complete` on a COMPLETED topic returns it unchanged.
- **No way back.** `start` on a COMPLETED topic is `409`; progress never moves back. A reset would be a separate, explicit feature.
- **Nothing automatic.** No topic is started or completed because an article was read or a tool was called; a caller must ask explicitly.
- **Concurrency.** Transitions update the row only if it still has the status that was read. A concurrent change gets `409` and can be retried, and unique `(user_id, topic)` prevents duplicate rows.
- **Database guards.** CHECK constraints enforce the status/timestamp combinations: NOT_STARTED has no timestamps, IN_PROGRESS has `started_at` only, COMPLETED has both. `completed_at >= started_at` is also enforced.

## 13. Context snapshot behaviour

The five reads of a context request are not one transaction. The response is the state they observed during the request; a write that lands between them can make it slightly inconsistent (for example a goal completed after the goals were read). For personalisation context this is acceptable, and there is no snapshot or versioning infrastructure.

## 14. Future authenticated AI integration

```text
Authenticated session (future auth step)
        ↓  server verifies the user
TrustedUserContext.fromAuthenticatedUser(userId)
        ↓
UserContextToolRegistry: get_user_financial_context, get_user_literacy_context
        ↓
FinancialContextService
```

[user-context.tools.ts](../../apps/api/src/ai/tools/user-context.tools.ts) prepares two tools for that agent:

- **Separate registry.** They are separate from the public agent's `AgentToolRegistry`, which cannot declare or call them.
- **No arguments.** They take no arguments at all: any argument, such as a `userId`, is rejected as `INVALID_ARGUMENTS`.
- **Trusted user only.** The user comes only from a `TrustedUserContext`, which only server code can issue. The tools throw if given anything else, including a structurally identical object.
- **Guarded results.** Results carry a guidance note: facts only, no judgement or recommendations, and a null amount is "not provided", not zero. They contain no ids.
- **Not yet reachable.** No request path issues a `TrustedUserContext` until authentication exists.

Later, and only with authentication, authorisation and explicit user-confirmed workflows, the agent may record learning progress. It must not change income, expenses, goals, phone numbers or the literacy level, or invent data.

## 15. Relationship with the finance engine

The finance engine (Step 4) remains the only place that calculates. The context supplies stored inputs (income, expenses, goal amounts) exactly as stored; a future agent that needs a figure still calls the calculation tools with explicit inputs. Personalised recommendations ("you can afford…", "save 30%") are not part of this layer and would need their own validated rules.

## 16. Relationship with the knowledge base

Literacy topics are the knowledge-base categories (the same database enum). Progress is per topic, not per article, and reading an article does not change progress. The knowledge base stays general and public; the literacy layer is personal and internal.

## 17. Security limitations before authentication

- There is no user authentication or authorisation yet. The internal API trusts any holder of `INTERNAL_API_TOKEN` to act for any user, so the token must stay server-side, and the API must not be exposed publicly (it listens on `127.0.0.1` by default).
- The public text agent and browser voice remain general-purpose and non-personalised until an authentication step decides which user a session belongs to.
- The token is a shared secret, not per-caller credentials; there is no audit log of internal reads yet.
