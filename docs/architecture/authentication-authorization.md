# Authentication and authorisation

FinVoice uses **guest accounts**: a person starts with only a preferred language (and an optional name). There are no phone numbers, one-time codes, passwords or e-mail addresses. The API identifies every request by a short-lived access token (a JWT), and a rotating refresh session in an HttpOnly cookie keeps the person signed in on that browser. **Logging out deletes the account with all of its data**, because there is no way to sign in to it again.

Authorisation is enforced by the API on every route:

- roles (`USER`, `ADMIN`) for administrative operations;
- ownership for personal financial data.

Guest accounts replaced the earlier phone-OTP sign-in (Step 11), which needed a paid SMS provider. FinVoice keeps no phone numbers: migration `20261018120000_guest_accounts` deleted the stored ones (see [database.md](database.md#authentication-tables)).

Code:

- [`apps/api/src/auth/`](../../apps/api/src/auth): services, guards, decorators, cookie, cleanup.
- [`apps/api/src/me/`](../../apps/api/src/me): the `/me` API.
- [`packages/contracts/src/auth.ts`](../../packages/contracts/src/auth.ts): request and response contracts.
- [`packages/config/src/auth.ts`](../../packages/config/src/auth.ts): configuration and its validation.

## 1. Authentication model

- **No identifier.** A user row has an id, an optional display name, a preferred language, a time zone, a status and a role. Nothing identifies the person outside FinVoice.
- **Registration and sign-in are one step:** `POST /auth/guest` creates a new account (`role USER`, `status ACTIVE`) and signs it in. Every call creates a **new** account: there is nothing to sign back in with.
- **Session:** a sign-in returns two credentials:
  - an **access token**: a JWT, 15 minutes, sent as `Authorization: Bearer`;
  - a **refresh token**: 256 random bits, 30 days, rotated on every use, held only in an HttpOnly cookie.
- **The refresh cookie is the account.** Whoever holds the browser's cookie can use the account; clearing cookies, another browser or another device means a new, empty account. There is no recovery.
- **Server-side truth:** the server decides identity, role, status, session validity and ownership. Nothing a client sends (a `userId`, `role` or `status` in a body, query or header) is trusted. Request schemas are strict and reject such fields with 400.

## 2. Guest sign-in

```text
POST /api/v1/auth/guest   {"preferredLanguage": "SI", "displayName"?: "Kamal"}
  → 201 {"accessToken", "tokenType": "Bearer", "expiresIn": 900, "user": {...}}
    Set-Cookie: finvoice_refresh=<token>; HttpOnly; SameSite=Lax; Path=/api/v1/auth
```

- **Body:** `preferredLanguage` (`SI`, `TA`, `EN`) is required; `displayName` is optional, trimmed, and a blank one is stored as null. Any other field (`role`, `status`, `userId`, `phoneNumber`, tokens …) answers `400`.
- **JSON only.** Any other content type answers `415 UNSUPPORTED_MEDIA_TYPE`, and nothing is created. Otherwise an HTML form on another website could post here and replace the visitor's refresh cookie with a new, empty account, cutting them off from their own (login CSRF). A browser can send a JSON body cross-site only after a CORS preflight, which the API never allows.
- **What is stored:** the user row and one `auth_sessions` row (the refresh token's SHA-256 only). No IP address, user agent or device fingerprint.

## 3. Guest rate limiting

Without phone numbers there is nothing per person to limit by, so the limit is **global**:

- **Limit:** at most `AUTH_GUEST_SESSION_LIMIT` (default 30) new accounts per `AUTH_GUEST_SESSION_WINDOW_SECONDS` (default 60), for all clients together. The next request gets `429 TOO_MANY_REQUESTS "FinVoice is busy. Try again in a minute."` and creates nothing.
- **Storage:** database-backed, counted from `users.created_at` (indexed). No Redis and no IP address.
- **Concurrency:** a transaction-scoped PostgreSQL advisory lock (`pg_advisory_xact_lock(hashtextextended('auth-guest-create', 0))`) serialises the count and the insert, so concurrent requests cannot all pass (tested: 10 parallel requests with a limit of 3 create exactly 3 accounts).
- **Limitation:** a global limit protects the database from mass account creation, but one abusive client can use it up for everyone for a minute. Before public launch, add an edge or distributed limiter per IP (at the load balancer or a reverse proxy).

## 4. Logout deletes the account

`POST /api/v1/auth/logout` requires a valid access token. It **deletes the user**, which removes its sessions, financial profile, goals and literacy data with it (`ON DELETE CASCADE`), clears the cookie and answers `204`. It is idempotent. The web app asks for confirmation first ("Logging out deletes your details and goals").

- **Why delete:** without a phone number, nobody can ever sign in to a logged-out guest account again. Keeping its data would only keep personal financial information that no one can use.
- **Access tokens:** an access token already issued stays cryptographically valid until it expires (at most 15 minutes), but its account is gone: `/auth/me` answers `401` and personal routes find no data (`404`).
- **ADMIN accounts are never deleted by logout.** For an `ADMIN`, logout only revokes that sign-in's token family.

## 5. Guest account cleanup

`pnpm auth:cleanup` (or `node dist/auth/auth-cleanup.cli.js` in a built deployment) also deletes **guest accounts nobody can sign in to any more**: role `USER`, at least 1 day old, and with no usable session (none that is unrevoked and unexpired). That covers accounts whose browser was cleared or abandoned (sessions expire after `AUTH_REFRESH_TOKEN_TTL_DAYS` without use), and logouts that could not reach the API. Their profiles, goals and literacy data go with them. The minimum age protects an account that is being created. `ADMIN` accounts are never deleted. See [8. Refresh sessions](#8-refresh-sessions) for session cleanup.

## 6. JWT

Access tokens are compact JWS tokens made with [`jose`](https://github.com/panva/jose):

- **Algorithm:** `HS256` with `AUTH_JWT_SECRET`. The algorithm is fixed in code: `jwtVerify(token, key, { algorithms: ["HS256"], issuer: "finvoice-api", audience: "finvoice", requiredClaims: [...] })`. A client cannot choose it: `alg: none`, `HS384`, `HS512` and asymmetric algorithms are all rejected.
- **Always verified, never merely decoded:** signature, algorithm, issuer, audience, expiry and presence of every claim. Then `sub` and `sid` must be UUIDs and `role` a known role.
- **Lifetime:** `AUTH_ACCESS_TOKEN_TTL_SECONDS` (default 900, allowed 60–3600).
- **Invalid tokens:** every failure (missing header, not `Bearer`, malformed, bad signature, expired, wrong issuer or audience, wrong algorithm, bad claims) answers the same `401 "Missing or invalid access token"` with `WWW-Authenticate: Bearer`. It never exposes the verification error. The scheme is matched case-insensitively (RFC 6750); the token must be a compact JWT.
- **No server-side lookup:** the guard does not query the database. An access token therefore stays valid until it expires, even after logout, deactivation or a role change (at most 15 minutes). Revocation acts on the refresh session, which is where the long-lived access is. `GET /auth/me` does read the user and answers `401` for a deactivated or deleted user.

## 7. Access-token claims

```json
{
  "sub": "<user id>",
  "role": "USER",
  "sid": "<auth session id>",
  "iss": "finvoice-api",
  "aud": "finvoice",
  "jti": "<random UUID>",
  "iat": 1790000000,
  "exp": 1790000900
}
```

That is all. There is no name, income, expense, goal, literacy data or refresh token. The token stays under 400 bytes. The guard attaches only `{ userId, role, sessionId }` to the request, never the user row. Controllers read it with `@CurrentUser()`.

## 8. Refresh sessions

Table `auth_sessions`: one row per refresh token.

| Column                   | Meaning                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `id`                     | Session id (UUIDv7): the `sid` claim of access tokens issued with it                    |
| `user_id`                | Owner (FK, cascades on user deletion)                                                   |
| `refresh_token_hash`     | SHA-256 hex of the token (unique). The token itself is never stored                     |
| `token_family_id`        | Shared by all sessions of one sign-in's rotation chain                                  |
| `expires_at`             | Set by the server: `AUTH_REFRESH_TOKEN_TTL_DAYS` (default 30, allowed 1–90) after issue |
| `revoked_at`             | Set on rotation, logout, reuse detection or deactivation                                |
| `last_used_at`           | When the token was presented for rotation                                               |
| `replaced_by_session_id` | The successor created by rotation                                                       |

- **Token:** a refresh token is 32 random bytes (256 bits), base64url (43 characters). It has enough entropy that a plain SHA-256 is safe: it cannot be guessed or brute-forced, so no pepper is needed.
- **One family per guest in practice:** a guest account gets exactly one sign-in (its token family). The session model still supports several families per user, and the tests keep covering that.
- **Cleanup:** `pnpm auth:cleanup` deletes sessions that expired more than 7 days ago, whether revoked or not, and the guest accounts described in [5](#5-guest-account-cleanup). It never deletes an unexpired session. Revoked sessions are deliberately kept until they expire, because a revoked row is what lets a reused token be recognised. The command never runs at startup and prints only counts.

## 9. Refresh rotation

`POST /api/v1/auth/refresh` (credential: the cookie; no access token needed):

1. The token's hash is looked up.
2. Everything else happens in one transaction holding a **per-family lock** (a PostgreSQL advisory lock), and the session is read again under that lock. Concurrent refreshes, logouts and revocations of one family are therefore decided one after the other, on current data.
3. If the session is active but expired, or the user is not active, the answer is `401`.
4. Otherwise it is **rotated**: a successor session is created (same family, new token and hash, fresh 30 days), and the old session is revoked with `replaced_by_session_id` and `last_used_at` set. Any other active session of the family (the unused half of an earlier grace overlap, see 10) is closed at the same time, so the successor is the family's only active session.
5. A new access token (with the new `sid`, and the role read from the database at that moment) is issued, and the new cookie is set.
6. A revoked session is reuse (see 10), apart from the narrow grace overlap described there.

The old refresh token does not work again, apart from that overlap. Every failure answers the same `401 "Invalid or expired refresh token"` and clears the cookie.

## 10. Token-family reuse detection

A refresh token whose session is already revoked has been presented twice: once legitimately and once by whoever copied it. The API cannot tell which caller is which, so it revokes **every session of the family**. Both the attacker and the legitimate user lose the sign-in; for a guest that means the account can no longer be used and is later deleted by the cleanup. The event is logged as `Refresh token reuse detected: token family revoked`, with no ids or tokens.

**Short overlap for browser races (Step 12).** A browser can legitimately send the same refresh token twice: a page reloaded (or closed, or navigated away from) while its refresh is in flight sends it again from the new page. Without an allowance, that would sign the person out. So the **immediately previous** token gets a narrow, one-time overlap:

- **When it applies:** the token was rotated (its replacement is known) at most **5 seconds** ago (`REFRESH_GRACE_MS`, fixed, not configurable), and has not been used this way before. Its replacement must still be active (not logged out, rotated on or revoked), the token must not have expired, and the user must still be active.
- **What happens:** the request gets a new session in the same family. The replacement stays valid too, so whichever cookie the browser ends up keeping works. The next normal rotation in the family closes the other one. Nothing is logged but "Refresh grace reuse" (no token or id).
- **Once only:** `grace_reused_at` records the use, set atomically under the family lock. A second overlap use of the same token is reuse.
- **Everything else is still reuse,** which revokes the whole family:
  - the token used after the 5 seconds;
  - a second overlap use;
  - a token revoked by logout, or closed by a sibling's rotation;
  - a token whose replacement is gone.

The overlap does **not** make refresh tokens reusable in general. Many simultaneous uses still end the sign-in: of any number of concurrent requests with one token, at most two succeed (one rotation and one overlap use), and the next one revokes the family, including those two. The residual risk is bounded: a thief who replays a copied token within those 5 seconds, before the legitimate browser does, gets one sibling session. That session is closed at the family's next rotation, and a later use of it is reuse.

## 11. Cookie security

The refresh token travels only in the cookie `AUTH_REFRESH_COOKIE_NAME` (default `finvoice_refresh`), configured in one place ([`refresh-cookie.ts`](../../apps/api/src/auth/refresh-cookie.ts)):

| Attribute       | Value                      | Why                                                                       |
| --------------- | -------------------------- | ------------------------------------------------------------------------- |
| `HttpOnly`      | always                     | Browser JavaScript (and any XSS) cannot read it; never in `localStorage`  |
| `SameSite`      | `Lax`                      | Not sent on cross-site POSTs (see 12)                                     |
| `Path`          | `/api/v1/auth`             | Sent only to the authentication endpoints, not to every API call          |
| `Secure`        | true in production         | `AUTH_REFRESH_COOKIE_SECURE`; `false` is rejected in production           |
| `Max-Age`       | refresh TTL                | Matches the server-side expiry (the server's `expires_at` is what counts) |
| `Cache-Control` | `no-store` on the response | Responses that set credentials are never cached                           |

The refresh token is never in a JSON body, a log or analytics, and never in the access token. It is not accepted as a Bearer token or in a request body.

**Non-browser clients** (future mobile or server clients) use the same contract. They keep the `Set-Cookie` value from `guest` and `refresh`, send it back as `Cookie: finvoice_refresh=<token>` to `/api/v1/auth/refresh`, and replace it with the new value each time. A client must store it as a secret and must not refresh concurrently with the same token.

## 12. CSRF considerations

- **Only three routes touch the cookie:** `/auth/refresh` uses it as a credential; `/auth/guest` and `/auth/logout` only set or clear it. Every other route needs the `Authorization` header, which a browser never attaches automatically, so ordinary API calls are not exposed to CSRF.
- **`SameSite=Lax`** stops browsers sending the cookie on cross-site `POST`s. A malicious site therefore cannot trigger a refresh with the victim's cookie.
- **Even a forced refresh** would only rotate the victim's token: the attacker cannot read the response, which is same-origin, and the API enables no CORS.
- **Guest creation is JSON-only** (see 2), so a cross-site form cannot replace the victim's session with a new account.
- **Logout** requires the Bearer token, so it cannot be forced cross-site.

This boundary relies on SameSite, which covers modern browsers. No CSRF-token framework is added. The web app (Step 12) keeps this boundary: browsers call the API only through the web app's same-origin proxy, so the cookie stays first-party and `SameSite=Lax` ([web-authentication.md](web-authentication.md#2-same-origin-proxy-cookie-decision)). A cross-origin or `SameSite=None` setup would need CSRF tokens or an origin check.

## 13. Roles

`users.role` is a PostgreSQL enum `user_role` (`USER`, `ADMIN`), default `USER`.

- **Never client-chosen.** `POST /auth/guest`, `PATCH /me` and `PATCH /users/:userId` all reject a `role` field (400). There is no API that changes a role.
- **`ADMIN` is assigned only in trusted server-side data** (see 20). Starting a guest session always creates a `USER`.
- **Checked from the verified token.** `@Roles("ADMIN")` with the global `RolesGuard` checks the role in the verified access token. That role was read from the database when the token was issued, so a role change takes effect at the next refresh (within 15 minutes).
- **Status codes:** a missing role answers `403 FORBIDDEN "You do not have permission to perform this action"`.
- **Endpoint-specific, not a super-user.** `ADMIN` does **not** grant access to other users' personal data: owner routes and `/me` give an administrator only their own data.

There is currently **no** `ADMIN`-only route: the only one, phone-number provisioning (`POST /api/v1/users`), was removed with phone numbers. The guard remains for future admin operations.

## 14. Owner authorisation

The global guard makes every route require a valid access token, **secure by default**. Exceptions must be declared explicitly:

- `@Public()`: health, calculations, knowledge, the general agent, ScamShield, guest sign-in and refresh.
- `@InternalOnly()`: the `/internal/*` routes, which take the service token instead (see 16).

A route under `/users/:userId/…` is marked `@OwnUserOnly()`. Its `:userId` must equal the token's `sub`.

- **The route id only selects a resource.** Identity always comes from the verified token.
- **Another user's id** answers **`404 "User not found"`**, exactly like a user that does not exist. This is resource hiding, so a caller cannot probe which ids exist. We chose 404 over 403 for the same reason, and apply it consistently to users, profiles and goals. **403** is reserved for role failures.
- **A malformed id** still answers `400` from validation. That reveals nothing either.
- **Goals** are always looked up within the caller's user id. Another user's goal id is indistinguishable from a missing goal (`404 "Financial goal not found"`), both through `/users/:userId/goals/:goalId` and through `/me/goals/:goalId`.
- **The UUID being hard to guess is not relied on:** tests use real ids of other users.

Status code summary:

| Status | When                                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 401    | No credentials; invalid, expired or wrongly signed token; invalid or reused refresh token; a deleted or inactive user at `/auth/me` |
| 403    | Authenticated, but the role does not allow the action                                                                               |
| 404    | Another user's resource (hidden), or a resource that does not exist                                                                 |
| 415    | `POST /auth/guest` with a body that is not JSON                                                                                     |
| 429    | Too many guest accounts created recently (all clients together)                                                                     |
| 503    | Authentication not configured (no JWT secret)                                                                                       |

## 15. /me endpoints

`/api/v1/me/*` is the preferred API for a signed-in user. The identity is **always** the token's `sub`:

- there is no `:userId` path parameter;
- bodies are strict (`userId` is rejected);
- routes without query parameters reject any query string (`?userId=…` → 400).

The routes are thin wrappers over the same services as `/users/:userId/…` and the internal user context, so business rules and database access are not duplicated. A test checks that `/me/financial-context` returns exactly what the internal endpoint returns for the same user.

| Method  | Path                    | Purpose                                                                   |
| ------- | ----------------------- | ------------------------------------------------------------------------- |
| `GET`   | `/me`                   | Own user record                                                           |
| `PATCH` | `/me`                   | Change own `displayName` / `preferredLanguage`                            |
| `GET`   | `/me/financial-profile` | Own profile                                                               |
| `PUT`   | `/me/financial-profile` | Create or replace own profile                                             |
| `POST`  | `/me/goals`             | Create an own goal                                                        |
| `GET`   | `/me/goals`             | List own goals (same filters and pagination)                              |
| `GET`   | `/me/goals/:goalId`     | One own goal                                                              |
| `PATCH` | `/me/goals/:goalId`     | Update an own goal                                                        |
| `GET`   | `/me/financial-context` | Own minimised financial context (as the internal context endpoint)        |
| `GET`   | `/me/literacy-context`  | Own literacy context                                                      |
| `GET`   | `/auth/me`              | Minimal identity: `id`, `preferredLanguage`, `timezone`, `role`, `status` |

**User changes.** A user can change only `displayName` and `preferredLanguage`, through `PATCH /me` or `PATCH /users/:userId`. `status` and `role` are administrative, and a `phoneNumber` field is rejected.

**Accounts are created only by `POST /auth/guest`.** There is no other registration or provisioning route.

## 16. Public and internal trust

There are two separate trust domains, and they are never mixed:

| Domain                      | Credential                                                 | Routes                           | Who                                             |
| --------------------------- | ---------------------------------------------------------- | -------------------------------- | ----------------------------------------------- |
| End user                    | JWT access token (`Authorization: Bearer`), refresh cookie | `/api/v1/*` (except public ones) | Browsers, apps                                  |
| Server-to-server (internal) | `INTERNAL_API_TOKEN` (`x-finvoice-internal-token` header)  | `/internal/*`                    | Voice gateway, the web server (admin dashboard) |

- **Neither credential opens the other domain.** An access token gets `401` on `/internal/*`, and the internal token gets `401` as a Bearer token on `/api/v1/me`.
- **Distinct secrets.** Configuration validation requires `AUTH_JWT_SECRET` and `INTERNAL_API_TOKEN` to be different. The JWT secret is never reused as the service token.
- **Kept:** the internal user-context endpoints (`/internal/users/:userId/*`) remain for trusted services. `/me/financial-context` and `/me/literacy-context` are the separate end-user path.

## 17. Current limitations

- **No recovery and no second device:** the browser's refresh cookie is the account. Clearing cookies, a private window, another browser or another device starts a new, empty account; the old one is deleted by the cleanup once its session expires.
- **Rate limiting** is global and database-backed (see 3). There is no per-IP limit.
- **No access-token revocation list:** a token outlives logout, deactivation or a role change by at most `AUTH_ACCESS_TOKEN_TTL_SECONDS` (for a deleted guest it can no longer reach any data).
- **Strict reuse detection with a 5-second overlap:** the immediately previous token may be used once more within 5 seconds of its rotation, for browser reload races (see 10). Three or more near-simultaneous uses of one token still revoke the family.
- **Missing features:** no device or session management UI, no way to move an account to another device, and no audit log (analytics deliberately records nothing about authentication).
- **Web app:** people start through the web app's `/login` page ([web-authentication.md](web-authentication.md)); the admin dashboard is not connected to it and still uses the internal token (see 20).
- **Voice and the AI agent** are not personalised (see 18, 19).
- **Secrets:** they must come from the deployment's secret store. Nothing in the repository contains one.

## 18. Future voice authentication

Browser voice (Step 7) is **unchanged and anonymous**:

- the gateway's `start_session` accepts no `userId`;
- the voice gateway does not require a user login;
- voice tools cannot read personal data.

Phone callers are anonymous too: caller ID is not a verified identity, and FinVoice stores no phone numbers. A later step may issue a trusted, short-lived voice-session identity from a verified access token, for example through a server-issued session ticket. The gateway would then act for that user through the internal user-context path. A browser will never be able to claim an identity by sending an id.

## 19. Future personalised AI

`POST /api/v1/agent/chat` stays **public and general-purpose**: no `userId`, no personal context, no user-context tools. The trusted user-context tools (`UserContextToolRegistry`, Step 8) are prepared for an authenticated agent. They will be given the identity from `@CurrentUser()` (the verified token), never from the request or from the model.

## 20. Admin authorisation

- **Human administrators are users with `role = ADMIN`.** There is no seeded or automatic administrator. An operator promotes an account with a direct, audited database change in the target environment, for example `UPDATE users SET role = 'ADMIN' WHERE id = '<user id>';`. The change takes effect at that account's next refresh. Because a guest account lives in one browser, an administrator account is only as durable as that browser's cookie; a durable admin sign-in is future work.
- **Admin operations are explicit per endpoint** with `@Roles("ADMIN")`. There are none today.
- **The analytics admin dashboard (Step 10)** still reads `/internal/admin/analytics/*` with `INTERNAL_API_TOKEN` from the Next.js server:
  - **The internal token is not a human admin credential.** It authenticates a FinVoice service, not a person, and must never reach a browser.
  - **Public admin access must use authenticated `ADMIN` authorisation.** No admin analytics route is exposed under `/api/v1` without it.
  - **The dashboard stays disabled by default** (`ADMIN_DASHBOARD_ENABLED=false`) until authenticated `ADMIN` users are connected to it.

## 21. Secret management

| Secret               | Purpose                  | Rules                                                                |
| -------------------- | ------------------------ | -------------------------------------------------------------------- |
| `AUTH_JWT_SECRET`    | HS256 signing key        | ≥ 43 characters (32 random bytes, base64url); required in production |
| `INTERNAL_API_TOKEN` | Service-to-service token | Separate (Step 7); must differ from `AUTH_JWT_SECRET`                |

Generate each secret independently:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

- **Where they live:** secrets come from the environment only. For local development that is your own `.env`, which is never committed. In deployments, use a secret store. `.env.example` contains placeholders, never values.
- **No secret appears in** the repository, logs, error messages (configuration errors name the variable, not the value), API responses or the JWT. Tests generate ephemeral secrets inside the test process.
- **Without the JWT secret, authentication is off.** Guest sign-in and every protected route answer `503 "Authentication is not configured"`; public routes keep working. Production refuses to start without it.
- **Rotating `AUTH_JWT_SECRET`** invalidates all access tokens immediately; users refresh transparently.
- **Refresh tokens** are not derived from any secret.
- **Older settings** (`AUTH_OTP_PEPPER`, `AUTH_OTP_PROVIDER`, `AUTH_OTP_DEV_CODE` and the other `AUTH_OTP_*` variables) are no longer used and are ignored; they can be deleted from environment files.
