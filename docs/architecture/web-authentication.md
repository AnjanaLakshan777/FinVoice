# Web authentication and onboarding

Step 12 connects the Next.js web app to the API's authentication ([authentication-authorization.md](authentication-authorization.md)). Sign-in uses **guest accounts**: no phone number, code or password. A person can:

- start with only a preferred language (and an optional name);
- stay signed in across page reloads in the same browser;
- complete a short financial onboarding;
- manage financial goals;
- log out, which deletes their details and goals.

Code:

- [`apps/web/lib/auth/`](../../apps/web/lib/auth): the auth client and state.
- [`apps/web/lib/server/`](../../apps/web/lib/server): the same-origin proxy.
- [`apps/web/lib/account/`](../../apps/web/lib/account): constants, messages and money strings.
- [`apps/web/app/(account)/`](<../../apps/web/app/(account)>): the pages.

## 1. Pages

| Route             | Access    | Purpose                                                                    |
| ----------------- | --------- | -------------------------------------------------------------------------- |
| `/login`          | Public    | Language (and optional name) → Start. Already signed in → `/dashboard`     |
| `/dashboard`      | Signed in | Name, language, monthly figures, active goals                              |
| `/onboarding`     | Signed in | "My details": name and language, monthly income and expenses, a first goal |
| `/goals`          | Signed in | All goals with progress; add a goal                                        |
| `/goals/[goalId]` | Signed in | One goal; update it (amounts, date, status)                                |

The signed-in pages are static shells that hold no personal data. Everything personal comes from the API through authenticated calls, and the API decides who may see what. Without a session they redirect to `/login`. The login page redirects only when a session exists, so there is no redirect loop.

Starting a guest session always creates a new account, so it goes to `/onboarding`; a person who is already signed in goes to `/dashboard`.

## 2. Same-origin proxy (cookie decision)

**Problem.** Production runs the web app and the API on different sites (for example Vercel and Render). The API has no CORS, and its refresh cookie is `SameSite=Lax` with `Path=/api/v1/auth`. A browser `fetch()` from the web origin straight to the API origin would therefore:

- be blocked without CORS;
- and, with CORS, still not carry a `SameSite=Lax` cookie on a cross-site request.

Making it work cross-site would need `SameSite=None`, credentialed CORS and CSRF protection: a weaker design.

**Decision: the browser talks only to the web origin.** A Next.js route handler, [`app/api/v1/[...path]/route.ts`](../../apps/web/app/api/v1/[...path]/route.ts), forwards `https://<web>/api/v1/*` to `<INTERNAL_API_URL>/api/v1/*` on the server:

```
Browser ──same origin──▶ Next.js /api/v1/* (route handler) ──server-side fetch──▶ API /api/v1/*
         ◀── Set-Cookie: finvoice_refresh=…; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Secure
```

- **The cookie becomes first-party** to the web origin (no `Domain` attribute). The browser sends it only to `https://<web>/api/v1/auth/*`, and the proxy forwards it to the API.
- **The API's cookie settings are unchanged:** HttpOnly, SameSite=Lax, Path=/api/v1/auth, Secure in production. There is no CORS, no `SameSite=None` and no second authentication system.
- **The proxy is narrow** ([`lib/server/api-proxy.ts`](../../apps/web/lib/server/api-proxy.ts)):
  - only `/api/v1/*`: never `/internal/*` or `/health`, and `.`/`..` path segments are refused;
  - request headers: only `accept`, `authorization` and `content-type`, plus `cookie` for `/api/v1/auth/*` only. Never IP addresses, user agents or the internal service token;
  - response headers: the status, the body, `content-type`, `cache-control`, `www-authenticate`, `retry-after` and every `Set-Cookie`, unchanged.
- **It logs nothing,** and an unreachable API gives a plain `503` in the API error format, with no details.
- **Configuration:** the target is `INTERNAL_API_URL`, read on the server at request time (from the server's environment, then the root `.env` in development) and never exposed to the browser. The web app never reads the internal service token for this. No new environment variable is needed.
- **Existing API calls are unaffected.** The voice gateway and the admin dashboard still call the API server-to-server. The only browser calls to the API are these proxied ones.

## 3. Access token: memory only

The access token (a 15-minute JWT) lives in a private field of the single `AuthClient` instance of the browser tab ([`auth-client.ts`](../../apps/web/lib/auth/auth-client.ts)):

- never in localStorage, sessionStorage, IndexedDB, a URL, or a cookie created by JavaScript;
- never in React state (the state holds only the `/auth/me` identity: id, language, time zone, role, status);
- never logged.

Tests check all of these: unit tests spy on storage and console, a static test scans the sources, and the browser E2E test inspects `document.cookie` and storage.

## 4. Refresh token and page reloads

The refresh token is the API's HttpOnly cookie: JavaScript can neither read nor delete it. On a full reload:

1. the in-memory access token is gone;
2. the auth provider calls `POST /api/v1/auth/refresh` (same origin, `credentials: "same-origin"`);
3. the browser attaches the HttpOnly cookie itself;
4. the API rotates the refresh token and sets the new cookie;
5. the client keeps the new access token in memory and loads `GET /api/v1/auth/me`.

No session (a missing, expired or revoked cookie) is a normal "signed out" state, not an error.

**Single refresh at a time:**

- **Concurrent 401s share one refresh.** When several requests get 401 at once, they share one in-flight refresh promise, and each retries once with the new token. A request whose 401 arrives after another request has already refreshed retries without refreshing again.
- **Refreshes are serialised across tabs.** Where available, a Web Lock (`finvoice-auth-refresh`) ensures two tabs never present the same rotating token at once.
- **Reloads don't lose the rotated cookie.** The refresh is sent with `keepalive: true`, so the browser completes it, and stores the rotated cookie, even if the page is reloaded or closed meanwhile.

**Reload while a refresh is in flight.** Refresh tokens are rotated: each works once. A page reloaded while its refresh is still in flight is the one legitimate way a browser sends the same token twice: the old page's request and the new page's request. The API allows exactly this:

- **The overlap:** the immediately previous token may be used **once more within 5 seconds** of its rotation. It gets a new session in the same family, so whichever cookie the browser keeps stays valid, and the person stays signed in.
- **It is not general reuse:** any other use of a rotated token (later, a second time, or after logout) is still treated as theft, and the whole sign-in is revoked.

See [authentication-authorization.md §10](authentication-authorization.md#10-token-family-reuse-detection). The browser E2E test reproduces the race deterministically (the page's refresh reaches the API, its response is lost to a reload, and the reloaded page sends the same token), and also reloads with natural timing, repeatedly.

If the session cannot be renewed while the person is using the app, the client ends it. The pages then return to `/login` with "Your session has ended. Please start again."

## 5. Sign-in flow

1. **Language.** The page asks for the preferred language (Sinhala by default) and an optional name. It says that no phone number or password is needed, and that the details stay with this browser until logout.
2. **Start.** `POST /api/v1/auth/guest` (JSON) creates the account and sets the refresh cookie; the access token stays in memory. The page loads the identity from `/auth/me` and goes to `/onboarding`.
3. **Errors.** A busy service (`429`, the API's global guest limit) gets "FinVoice is busy right now. Please wait a minute and try again."; an invalid name shows the API's field message; an unreachable service gets "FinVoice is not available right now".

Because a guest account lives in one browser, clearing cookies, a private window or another device starts a new, empty account.

## 6. Onboarding and goals

Onboarding and goals use only the existing `/me` API (no new endpoints, no user id from the browser):

- name and language: `PATCH /me`, after which the identity is reloaded from `/auth/me`;
- monthly income and expenses: `PUT /me/financial-profile` (empty means "not provided", and the stored currency is kept);
- goals: `POST /me/goals`, `GET /me/goals`, `GET /me/goals/:goalId` and `PATCH /me/goals/:goalId`.

- **Contract values:** goal types, statuses and languages mirror the contracts. A test keeps them in sync, and browser code imports contract types only, so no validation library ships to the browser.
- **Money is a decimal string end to end:**
  - input: thousands separators and spaces are removed ("150,000" → "150000"), nothing else;
  - display: digits are grouped ("LKR 150,000.00");
  - progress: a native `<progress>` over exact whole cents (BigInt). The page shows the API's saved and target amounts and calculates no financial result.
- **The API validates everything:** amount format, current ≤ target, dates, statuses and languages. Its field messages ("Must not exceed targetAmount") appear next to the fields. Other failures get simple messages: service unavailable, session ended, not found.
- **Another person's goal id** in `/goals/[goalId]` is simply "not found": the API looks the id up among the signed-in person's own goals.

## 7. Logout

"Log out" first asks for confirmation, because logging out **deletes the account**: "Logging out deletes your details and goals from FinVoice. You cannot get them back." with "Delete my data and log out" and "Cancel". Then:

1. the client calls `POST /api/v1/auth/logout` with the access token (refreshing first if it has expired);
2. the API deletes the guest account (profile, goals and literacy data with it) and clears the cookie;
3. the client drops the in-memory token (even if the API cannot be reached; the account is then deleted later by `pnpm auth:cleanup`, because nobody can sign in to it any more);
4. the state becomes signed out, and the page returns to `/login`.

JavaScript never touches the cookie.

## 8. CSRF

- **The refresh cookie** is sent only to the web origin's `/api/v1/auth/*`, and `SameSite=Lax` keeps it off cross-site POSTs.
- **Every other API call** needs the Bearer token, which only this tab's JavaScript holds.
- **CORS:** the web app adds none, so other sites cannot read proxied responses. This is the same boundary as described in [authentication-authorization.md §12](authentication-authorization.md#12-csrf-considerations), now on the web origin.

## 9. Local development

Put these in your own root `.env` (never committed):

- `AUTH_JWT_SECRET`: a random secret (different from `INTERNAL_API_TOKEN`);
- `NODE_ENV=development`.

Then:

1. start the database and the apps: `pnpm db:up`, `pnpm db:migrate`, `pnpm dev`;
2. open http://localhost:3000/login;
3. choose a language and press **Start**.

The web server proxies `/api/v1` to `INTERNAL_API_URL` (default `http://127.0.0.1:4000`). The cookie is not `Secure` in development, so plain `http://localhost` works.

## 10. Production deployment

- **Web app (for example Vercel):**
  - set `INTERNAL_API_URL` to the API's HTTPS base URL, a server-side variable and never `NEXT_PUBLIC_*`;
  - no auth secret is needed on the web app.
- **API (for example Render):**
  - `NODE_ENV=production`, with the auth secrets from the platform's secret store;
  - the refresh cookie is `Secure` automatically;
  - no CORS configuration is needed, since browsers never call the API directly.
- **No SMS or other paid provider is needed:** guest sign-in works in production as soon as `AUTH_JWT_SECRET` is set.
- **Admin:** the admin dashboard stays disabled by default and is unchanged (internal-token based).

## 11. Tests

- **Unit and component tests** (`pnpm --filter @finvoice/web test`):
  - the auth client: tokens, refresh, concurrency, logout;
  - the proxy: paths, headers, cookies, failures;
  - message and money helpers, and the contract mirrors;
  - the login, protected, dashboard, onboarding and goals pages;
  - static security checks.
- **Browser end-to-end** (`pnpm test:e2e`, real Chrome or Edge via `playwright-core`, no browser download):
  - **Setup:** starts the **built** API and web app (`pnpm build` first) against the local database (`pnpm db:up && pnpm db:migrate`). The JWT secret is generated in the test and exists only in the test's API process.
  - **Flow:** guest sign-in, onboarding, goals, reloads, logout (with confirmation and deletion) and protected pages.
  - **Checks:** the cookie's flags; no phone or code field; no token in storage, URLs or logs; no direct browser call to the API.
  - **Cleanup:** logging out deletes each test account; anything left by a failed run is deleted by its unique test name.
  - **Scope:** not part of `pnpm test` or CI (it needs the database and a browser).
