# FinVoice system overview

> **Status:** Step 8 (personal financial context). The repository structure, service skeletons, health endpoints, the core database tables, a validated REST API for users, financial profiles and goals ([domain-api.md](../api/domain-api.md)), a deterministic calculation engine for loans, savings and budgets ([financial-calculation-engine.md](financial-calculation-engine.md)), a curated, source-backed knowledge base with read-only retrieval ([financial-knowledge-base.md](financial-knowledge-base.md)), a text AI agent that uses them through allowlisted tools ([ai-agent.md](ai-agent.md)) a local/development real-time browser voice experience over Gemini Live ([browser-voice.md](browser-voice.md)), and a personal financial context and financial-literacy layer reachable only through a token-protected internal API ([personal-financial-context.md](personal-financial-context.md)) exist. Everything else in this document describes the **intended** architecture and will be built in later steps. The database design is documented in [database.md](database.md).

## Purpose

FinVoice is a voice-first financial inclusion and financial literacy platform for Sri Lankan users. People reach it in Sinhala, Tamil or English through two channels:

- **Telephone**: an ordinary phone call. No smartphone, app or data plan is needed.
- **Browser**: the FinVoice web application.

Both channels share the same backend, so financial rules, data and behaviour stay consistent.

## Voice call path

```text
Caller
   ↓
Telephony / SIP
   ↓
Asterisk
   ↓
AudioSocket
   ↓
Voice Gateway          (apps/voice-gateway)
   ↓
Gemini Live
   ↓
FinVoice Tools
   ↓
Backend API            (apps/api)
   ↓
PostgreSQL
```

| Layer               | Responsibility                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Caller**          | A user on a mobile or landline phone.                                                                                                                                                                                                                                                                                                                                    |
| **Telephony / SIP** | A SIP trunk from a telephony provider delivers inbound calls from the public phone network to FinVoice.                                                                                                                                                                                                                                                                  |
| **Asterisk**        | Open-source PBX that terminates the SIP call and handles call control: answering, the dial plan, DTMF, transfers and hang-up. It contains no FinVoice business logic.                                                                                                                                                                                                    |
| **AudioSocket**     | A simple TCP protocol built into Asterisk. It streams the call's raw audio (typically 16-bit signed linear PCM) in both directions between Asterisk and an external service, one connection per call.                                                                                                                                                                    |
| **Voice Gateway**   | FinVoice's real-time audio service. It accepts AudioSocket connections, manages the lifecycle of each voice session, converts audio formats and sample rates between telephony and the model, streams audio to and from Gemini Live, handles interruptions (barge-in), and executes the tool calls the model requests.                                                   |
| **Gemini Live**     | Real-time speech model that listens to the caller and replies with generated speech. When it needs facts or must take an action, it requests a **tool call** instead of guessing.                                                                                                                                                                                        |
| **FinVoice Tools**  | A small, explicitly defined set of functions exposed to the model (for example "look up X" or "explain Y"). Each tool has a typed contract in `packages/contracts`. The voice gateway runs a tool by calling the Backend API; tools never access the database directly. Financial figures always come from the calculation engine through the API, never from the model. |
| **Backend API**     | The single owner of business logic, validation, authorization, persistence and auditing. Every channel goes through it.                                                                                                                                                                                                                                                  |
| **PostgreSQL**      | The primary system of record. Only the Backend API connects to it.                                                                                                                                                                                                                                                                                                       |

## Web application path

```text
Browser
   ↓
Web application        (apps/web, Next.js)
   ↓  HTTPS
Backend API            (apps/api)
   ↓
PostgreSQL
```

The web application talks to the Backend API **independently** of the voice path. It does not route requests through the voice gateway, Asterisk or Gemini Live. Web and voice are two separate clients of the same API.

## Browser voice path (Step 7)

```text
Browser (/voice)
   ↓  WebSocket: JSON messages, 16 kHz PCM up, 24 kHz PCM down
Voice Gateway          (apps/voice-gateway)
   ↓                                   ↓  internal HTTP + shared token
Gemini Live                            Backend API (apps/api, /internal/voice/*)
   (tool calls go back through            ↓  AgentToolRegistry (Step 6)
    the gateway to the API)            finance engine · knowledge service → PostgreSQL
```

Browser voice uses a WebSocket between the browser and the voice gateway. The gateway holds the Gemini API key, opens one Gemini Live session per browser connection, and runs the model's tool calls through two token-protected internal API endpoints that reuse the Step 6 tool registry, so the gateway has no business logic and no database access. The browser only chooses a language and streams audio; it never receives the key. There is no authentication yet, so this is a local/development setup. Details: [browser-voice.md](browser-voice.md).

## Architectural principles

1. **One owner of the data.** Only `apps/api` reads and writes PostgreSQL. The voice gateway and the web app are clients of the API.
2. **The voice gateway is a real-time adapter, not a business service.** It moves audio and relays tool calls; domain rules belong in the API. This keeps the latency-sensitive audio path small and lets each service scale on its own.
3. **The model acts only through tools.** Gemini Live cannot reach data or side effects except through explicitly defined, typed and validated FinVoice tools, which in turn go through the API.
4. **Contracts at every boundary.** Payloads that cross a service boundary are defined once in `packages/contracts` and shared by producer and consumer.
5. **Configuration is validated at startup.** Each service loads its environment through `packages/config` and refuses to start when it is misconfigured. Secrets come only from the environment and are never committed.
6. **Every service is observable.** Each service exposes `GET /health` for liveness checks.

## Repository mapping

| Path                             | Component                                                | Step 1 state                                        |
| -------------------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| `apps/web`                       | Web application (Next.js)                                | Homepage and `/voice` page                          |
| `apps/api`                       | Backend API (NestJS)                                     | Health + domain API `/api/v1`                       |
| `apps/voice-gateway`             | Voice gateway (Node.js)                                  | `GET /health`, browser voice WebSocket `/voice`     |
| `packages/shared`                | Framework-agnostic shared types and utilities            | `ServiceHealth` type                                |
| `packages/contracts`             | API and tool contracts                                   | Domain API request schemas and response types       |
| `packages/finance-engine`        | Deterministic financial calculations                     | Loan, savings and budget calculators                |
| `apps/api/prisma/knowledge`      | Curated knowledge content and insert-only seed           | 12 CBSL-sourced articles                            |
| `apps/api/src/financial-context` | Personal financial context and literacy (internal only)  | `/internal/users/*` (token-protected)               |
| `apps/api/src/ai`                | Text AI agent: Gemini adapter, tool registry, agent      | `POST /api/v1/agent/chat`, internal voice endpoints |
| `packages/config`                | Environment parsing and validation                       | API and voice gateway loaders                       |
| `docker-compose.yml`             | Local infrastructure                                     | PostgreSQL 18                                       |
| `infrastructure/`                | Container, database and (later) telephony infrastructure | Placeholders                                        |

## Not yet built

In later steps: authentication and authorisation (which will enable personalised answers through the prepared user-context tools), Asterisk and SIP configuration, the AudioSocket server (reusing the Step 7 voice session and Gemini Live adapter), RAG over the knowledge base, knowledge administration, scam detection, authentication and authorisation, and deployment.
