# Authentication and authorisation

FinVoice users sign in with their phone number and a one-time password (OTP): there are no passwords. The API then identifies every request by a short-lived access token (a JWT). A rotating refresh session in an HttpOnly cookie keeps the user signed in.

Authorisation is enforced by the API on every route:

- roles (`USER`, `ADMIN`) for administrative operations;
- ownership for personal financial data.

This is the Step 11 foundation. It is **not yet a deployable production login**: no real SMS provider exists yet (see [20. Current limitations](#20-current-limitations)).

Code:

- [`apps/api/src/auth/`](../../apps/api/src/auth): services, guards, decorators, cookie, cleanup.
- [`apps/api/src/me/`](../../apps/api/src/me): the `/me` API.
- [`packages/contracts/src/auth.ts`](../../packages/contracts/src/auth.ts): request and response contracts.
- [`packages/config/src/auth.ts`](../../packages/config/src/auth.ts): configuration and its validation.

## 1. Authentication model

- **Identifier:** the phone number (E.164, the existing unique `users.phone_number`). There is no second phone field, no password and no username.
- **Proof of possession:** an 8-digit OTP delivered to that phone.
- **Registration:** passwordless. The first successful verification for an unknown number creates the account (`role USER`, `status ACTIVE`).
- **Session:** a successful sign-in returns two credentials:
  - an **access token**: a JWT, 15 minutes, sent as `Authorization: Bearer`;
  - a **refresh token**: 256 random bits, 30 days, rotated on every use, held only in an HttpOnly cookie.
- **Server-side truth:** the server decides identity, role, status, session validity and ownership. Nothing a client sends (a `userId`, `role` or `status` in a body, query or header) is trusted. Request schemas are strict and reject such fields with 400.

## 2. Phone OTP flow

```
POST /api/v1/auth/request-otp   {"phoneNumber": "+94771234567"}
  → 202 {"challengeId", "expiresIn": 300, "message": "If this number can be authenticated, …"}
  (the code is delivered out of band through the OtpDeliveryProvider)

POST /api/v1/auth/verify-otp    {"challengeId", "code": "12345678", "displayName"?, "preferredLanguage"?}
  → 200 {"accessToken", "tokenType": "Bearer", "expiresIn": 900, "user": {id, preferredLanguage, timezone, role}}
    Set-Cookie: finvoice_refresh=<refresh token>; HttpOnly; SameSite=Lax; Path=/api/v1/auth; …

GET  /api/v1/auth/me            Authorization: Bearer <access token>
POST /api/v1/auth/refresh       Cookie: finvoice_refresh=…   → new access token + new cookie
POST /api/v1/auth/logout        Authorization: Bearer …       → 204, cookie cleared
```

`request-otp` does four things in order:

1. validates the number;
2. applies the rate limit;
3. supersedes the number's active challenges;
4. stores a new challenge (hash only) and hands the code to the delivery provider.

It never looks up the user.

`verify-otp` then:

1. checks and consumes the challenge;
2. finds or creates the user of that phone number;
3. refuses inactive accounts;
4. starts a new session.

`displayName` and `preferredLanguage` (default `EN`) are used **only when the account is created**. For an existing user they are ignored. They cannot change the account.

## 3. OTP security

| Property   | Implementation                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Generation | `crypto.randomInt(0, 10^8)`, zero-padded to 8 digits: uniform, from Node's CSPRNG. `Math.random` is never used (a unit test checks the auth sources). 8 digits (10^8 codes) with at most 5 guesses gives an online guessing chance of 5 × 10⁻⁸ per challenge.                                                                                                      |
| Storage    | `code_hash = HMAC-SHA-256(AUTH_OTP_PEPPER, "<challengeId>:<code>")`, hex. A plain hash of an 8-digit code could be brute-forced offline from a database copy in seconds. The pepper is not in the database, which prevents that, and the challenge id makes every hash unique. Nothing else is stored about the code. A CHECK constraint enforces the hash format. |
| Comparison | Constant time (`timingSafeEqual` of the two digests).                                                                                                                                                                                                                                                                                                              |
| Never      | Logged, returned by the API, included in errors, sent to analytics, or stored in plaintext. Tests check the logs, responses, database rows and analytics.                                                                                                                                                                                                          |
| Not stored | The message text, the delivery provider's response, IP addresses and user agents.                                                                                                                                                                                                                                                                                  |

The challenge id is a random UUID (v4) generated by the API. It identifies the challenge but is not a credential: without the code it is useless, and guessing codes is limited per challenge.

## 4. OTP expiry

A challenge expires `AUTH_OTP_TTL_SECONDS` (default 300 s, allowed 60–1800) after creation. An expired challenge fails with the same `401` as a wrong code, so the response never tells whether the code was right. Expired challenges are deleted by [`pnpm auth:cleanup`](#10-refresh-sessions).

## 5. Attempt limits

Each challenge allows `AUTH_OTP_MAX_ATTEMPTS` (default 5, allowed 1–10) verification attempts. Verification is three atomic steps:

1. **Reserve an attempt.** One conditional `UPDATE … SET attempts = attempts + 1` runs only while the challenge is unconsumed, not superseded, unexpired and `attempts < max_attempts`, and returns the row. Concurrent guesses each take a slot, so no more than 5 codes are ever compared. A 6th attempt fails, even with the correct code: the counter is never reset.
2. **Compare** the HMAC in constant time.
3. **Consume.** One conditional `UPDATE … SET consumed_at = now WHERE consumed_at IS NULL`. Of several concurrent correct submissions exactly one succeeds; the others get 401.

`max_attempts` is stored per challenge, so changing the configuration never affects challenges already issued. CHECK constraints keep `0 ≤ attempts ≤ max_attempts` and `1 ≤ max_attempts ≤ 20`.

## 6. Rate limiting

- **Limit:** at most `AUTH_OTP_REQUEST_LIMIT` (default 3) challenges per phone number per `AUTH_OTP_REQUEST_WINDOW_SECONDS` (default 900). The next request gets `429 TOO_MANY_REQUESTS`. The answer is the same for registered and unknown numbers.
- **Storage:** database-backed. Requests are counted from `otp_challenges` (indexed on `(phone_number, created_at)`). There is no Redis and no IP address.
- **Concurrency:** a transaction-scoped PostgreSQL advisory lock per phone number (`pg_advisory_xact_lock(hashtextextended('otp-request:' || phone, 0))`) serialises the three steps: count, supersede and insert. Concurrent requests therefore cannot all pass the count (tested with 10 parallel requests, of which exactly 3 succeed).
- **Limitation:** this is basic per-number protection, not a complete distributed rate limiter. It does not stop one client from spraying many different numbers, and it adds database work per request. Before large-scale production use, add an edge or distributed limiter (per IP or ASN, per number, global), e.g. Redis-based or at the load balancer. The check sits in `OtpChallengeService.create`, so it can be replaced there.

## 7. Account enumeration protection

- `request-otp` never reads `users`. For registered, unregistered and inactive numbers it returns the same status and body structure. Tests check this. It returns `400` only for a malformed number and `429` only for too many requests, and both are independent of any account.
- `verify-otp` answers every code failure identically: wrong, expired, used, superseded or exhausted code, and unknown challenge. The answer is `401 "The verification code is invalid or has expired"`. It never says "not registered" or "user not found".
- An **inactive** account gets `401 "Authentication failed"` after a correct code, with no tokens. Only someone who has just proved possession of the phone can see that difference.

## 8. JWT

Access tokens are compact JWS tokens made with [`jose`](https://github.com/panva/jose):

- **Algorithm:** `HS256` with `AUTH_JWT_SECRET`. The algorithm is fixed in code: `jwtVerify(token, key, { algorithms: ["HS256"], issuer: "finvoice-api", audience: "finvoice", requiredClaims: [...] })`. A client cannot choose it: `alg: none`, `HS384`, `HS512` and asymmetric algorithms are all rejected.
- **Always verified, never merely decoded:** signature, algorithm, issuer, audience, expiry and presence of every claim. Then `sub` and `sid` must be UUIDs and `role` a known role.
- **Lifetime:** `AUTH_ACCESS_TOKEN_TTL_SECONDS` (default 900, allowed 60–3600).
- **Invalid tokens:** every failure (missing header, not `Bearer`, malformed, bad signature, expired, wrong issuer or audience, wrong algorithm, bad claims) answers the same `401 "Missing or invalid access token"` with `WWW-Authenticate: Bearer`. It never exposes the verification error. The scheme is matched case-insensitively (RFC 6750); the token must be a compact JWT.
- **No server-side lookup:** the guard does not query the database. An access token therefore stays valid until it expires, even after logout, deactivation or a role change (at most 15 minutes). Revocation acts on the refresh session, which is where the long-lived access is. `GET /auth/me` does read the user and answers `401` for a deactivated or deleted user.

## 9. Access-token claims

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

That is all. There is no phone number, name, income, expense, goal, literacy data, OTP or refresh token. The token stays under 400 bytes. The guard attaches only `{ userId, role, sessionId }` to the request, never the user row. Controllers read it with `@CurrentUser()`.

## 10. Refresh sessions

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
- **Multiple devices:** each sign-in creates a new family. A user may have many; signing in on one device never revokes the others. There is no device-management UI yet.
- **Cleanup:** `pnpm auth:cleanup` (or `node dist/auth/auth-cleanup.cli.js` in a built deployment) deletes:
  - OTP challenges that expired more than 1 day ago;
  - sessions that expired more than 7 days ago, whether revoked or not.

  It never deletes an unexpired session. Revoked sessions are deliberately kept until they expire, because a revoked row is what lets a reused token be recognised. The command never runs at startup and prints only counts.

## 11. Refresh rotation

`POST /api/v1/auth/refresh` (credential: the cookie; no access token needed):

1. The token's hash is looked up.
2. If the session is revoked, that is **reuse** (see 12). If it has expired, or the user is not active, the answer is `401`.
3. In one transaction, a successor session is created (same family, new token and hash, fresh 30 days). The old session is then revoked **conditionally** (`WHERE revoked_at IS NULL`), with `replaced_by_session_id` and `last_used_at` set. If the conditional update matches nothing, the token was used concurrently: the transaction rolls back and the attempt is treated as reuse.
4. A new access token (with the new `sid`, and the role read from the database at that moment) is issued, and the new cookie is set.

The old refresh token never works again. Every failure answers the same `401 "Invalid or expired refresh token"` and clears the cookie.

## 12. Token-family reuse detection

A refresh token whose session is already revoked has been presented twice: once legitimately and once by whoever copied it. The API cannot tell which caller is which, so it revokes **every session of the family**. Both the attacker and the legitimate user must sign in again. The event is logged as `Refresh token reuse detected: token family revoked`, with no ids or tokens. Other families of the same user (other devices) are not affected.

Strictness trade-off: two genuinely simultaneous refreshes with the same token (for example two browser tabs racing) are also treated as reuse. At most one succeeds, and the family is then revoked. Tests cover this. A client should serialise refreshes. A grace period for this case can be considered with the web integration.

## 13. Logout

`POST /api/v1/auth/logout` requires a valid access token. It revokes the whole token family of the token's session (`sid`), which is this device's sign-in including all rotated successors. It clears the cookie and answers `204`. It is idempotent. Other devices stay signed in. The access token itself remains valid until its expiry (at most 15 minutes): there is no server-side access-token blacklist, deliberately.

## 14. Cookie security

The refresh token travels only in the cookie `AUTH_REFRESH_COOKIE_NAME` (default `finvoice_refresh`), configured in one place ([`refresh-cookie.ts`](../../apps/api/src/auth/refresh-cookie.ts)):

| Attribute       | Value                      | Why                                                                       |
| --------------- | -------------------------- | ------------------------------------------------------------------------- |
| `HttpOnly`      | always                     | Browser JavaScript (and any XSS) cannot read it; never in `localStorage`  |
| `SameSite`      | `Lax`                      | Not sent on cross-site POSTs (see 15)                                     |
| `Path`          | `/api/v1/auth`             | Sent only to the authentication endpoints, not to every API call          |
| `Secure`        | true in production         | `AUTH_REFRESH_COOKIE_SECURE`; `false` is rejected in production           |
| `Max-Age`       | refresh TTL                | Matches the server-side expiry (the server's `expires_at` is what counts) |
| `Cache-Control` | `no-store` on the response | Responses that set credentials are never cached                           |

The refresh token is never in a JSON body, a log or analytics, and never in the access token. It is not accepted as a Bearer token or in a request body.

**Non-browser clients** (future mobile or server clients) use the same contract. They keep the `Set-Cookie` value from `verify-otp` and `refresh`, send it back as `Cookie: finvoice_refresh=<token>` to `/api/v1/auth/refresh`, and replace it with the new value each time. A client must store it as a secret and must not refresh concurrently with the same token.

## 15. CSRF considerations

- **Only three routes use the cookie as a credential:** `/auth/refresh`, and (through `Path`) `/auth/verify-otp` and `/auth/logout`, where it is only set or cleared. Every other route needs the `Authorization` header, which a browser never attaches automatically, so ordinary API calls are not exposed to CSRF.
- **`SameSite=Lax`** stops browsers sending the cookie on cross-site `POST`s. A malicious site therefore cannot trigger a refresh with the victim's cookie.
- **Even a forced refresh** would only rotate the victim's token: the attacker cannot read the response, which is same-origin, and the API enables no CORS.
- **Logout** requires the Bearer token, so it cannot be forced cross-site.

This boundary relies on SameSite, which covers modern browsers. No CSRF-token framework is added now. The web authentication step (a Next.js server or BFF in front of the API, possibly on another origin) must revisit this: a cross-origin or `SameSite=None` setup would need CSRF tokens or an origin check.

## 16. Roles

`users.role` is a PostgreSQL enum `user_role` (`USER`, `ADMIN`), default `USER`. Existing users received `USER` through the column default in the migration.

- **Never client-chosen.** Registration, verification, `PATCH /me`, `PATCH /users/:userId` and admin provisioning all reject a `role` field (400). There is no API that changes a role.
- **`ADMIN` is assigned only in trusted server-side data** (see 25). Signing up always creates a `USER`.
- **Checked from the verified token.** `@Roles("ADMIN")` with the global `RolesGuard` checks the role in the verified access token. That role was read from the database when the token was issued, so a role change takes effect at the next sign-in or refresh (within 15 minutes).
- **Status codes:** a missing role answers `403 FORBIDDEN "You do not have permission to perform this action"`.
- **Endpoint-specific, not a super-user.** `ADMIN` does **not** grant access to other users' personal data: owner routes and `/me` give an administrator only their own data.

Current admin-only operation: `POST /api/v1/users` (provisioning, see 18).

## 17. Owner authorisation

The global guard makes every route require a valid access token, **secure by default**. Exceptions must be declared explicitly:

- `@Public()`: health, calculations, knowledge, the general agent, ScamShield, and sign-in and refresh.
- `@InternalOnly()`: the `/internal/*` routes, which take the service token instead (see 19).

A route under `/users/:userId/…` is marked `@OwnUserOnly()`. Its `:userId` must equal the token's `sub`.

- **The route id only selects a resource.** Identity always comes from the verified token.
- **Another user's id** answers **`404 "User not found"`**, exactly like a user that does not exist. This is resource hiding, so a caller cannot probe which ids exist. We chose 404 over 403 for the same reason, and apply it consistently to users, profiles and goals. **403** is reserved for role failures.
- **A malformed id** still answers `400` from validation. That reveals nothing either.
- **Goals** are always looked up within the caller's user id. Another user's goal id is indistinguishable from a missing goal (`404 "Financial goal not found"`), both through `/users/:userId/goals/:goalId` and through `/me/goals/:goalId`.
- **The UUID being hard to guess is not relied on:** tests use real ids of other users.

Status code summary:

| Status | When                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 401    | No credentials; invalid, expired or wrongly signed token; wrong, expired or used code; invalid or reused refresh token; inactive user at sign-in |
| 403    | Authenticated, but the role does not allow the action                                                                                            |
| 404    | Another user's resource (hidden), or a resource that does not exist                                                                              |
| 429    | Too many OTP requests for the number                                                                                                             |
| 503    | Authentication not configured (no secrets), or no OTP delivery provider                                                                          |

## 18. /me endpoints

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

**User changes.** A user can change only `displayName` and `preferredLanguage`, through `PATCH /me` or `PATCH /users/:userId`:

- **The phone number** is the login identity. Changing it needs its own OTP-verified flow (future).
- **`status` and `role`** are administrative.

The old Step 3 `PATCH /users/:userId` accepted `phoneNumber` and `status`; both are now rejected.

**`POST /api/v1/users`** is no longer registration. It is **ADMIN-only provisioning**, e.g. support creating an account for someone: `401` without a token, `403` for a USER. The new user is always `USER`/`ACTIVE`. People sign up through `verify-otp`.

## 19. Public and internal trust

There are two separate trust domains, and they are never mixed:

| Domain                      | Credential                                                 | Routes                           | Who                                             |
| --------------------------- | ---------------------------------------------------------- | -------------------------------- | ----------------------------------------------- |
| End user                    | JWT access token (`Authorization: Bearer`), refresh cookie | `/api/v1/*` (except public ones) | Browsers, apps                                  |
| Server-to-server (internal) | `INTERNAL_API_TOKEN` (`x-finvoice-internal-token` header)  | `/internal/*`                    | Voice gateway, the web server (admin dashboard) |

- **Neither credential opens the other domain.** An access token gets `401` on `/internal/*`, and the internal token gets `401` as a Bearer token on `/api/v1/me`.
- **Distinct secrets.** Configuration validation requires `AUTH_JWT_SECRET`, `AUTH_OTP_PEPPER` and `INTERNAL_API_TOKEN` to be pairwise different. The JWT secret is never reused as the service token.
- **Kept in this step:** the internal user-context endpoints (`/internal/users/:userId/*`) remain for trusted services. `/me/financial-context` and `/me/literacy-context` are the separate end-user path.

## 20. Current limitations

- **No real SMS provider:** `AUTH_OTP_PROVIDER` supports only `dev`, which is allowed in development and test only. In production `request-otp` therefore answers `503 "Verification code delivery is not configured"`. **Authentication cannot be used in production until an SMS provider is implemented.**
- **Rate limiting** is per phone number, database-backed and single-region. There is no per-IP or global limit (see 6).
- **No access-token revocation list:** a token outlives logout, deactivation or a role change by at most `AUTH_ACCESS_TOKEN_TTL_SECONDS`.
- **Strict reuse detection:** concurrent refreshes revoke the family (see 12).
- **Missing features:** no device or session management UI, no "log out everywhere", no phone-number change flow, no account recovery beyond OTP, and no audit log (analytics deliberately records nothing about authentication).
- **Web app:** it does not sign users in yet, and the admin dashboard still uses the internal token (see 25).
- **Voice and the AI agent** are not personalised (see 23, 24).
- **Secrets:** they must come from the deployment's secret store. Nothing in the repository contains one.

## 21. Development OTP provider

For local development without SMS, set in your own `.env`:

```
AUTH_OTP_PROVIDER=dev
AUTH_OTP_DEV_CODE=<8 digits you choose>
```

The `DevOtpDeliveryProvider` uses that fixed code for every challenge and sends nothing. The code is still stored only as an HMAC. It is never logged, returned or sent to the browser: the developer knows it from their own `.env`.

**The development OTP provider is for development and test only:**

- It is allowed **only** when `NODE_ENV` is exactly `development` or `test`. This is an allowlist (`DEV_OTP_PROVIDER_ENVIRONMENTS`).
- It is **never** allowed in staging, preview, production or any other environment.
- It is also refused when `NODE_ENV` is unset, although `NODE_ENV` otherwise defaults to `development`, and for any other spelling (`Development`, `" development"`, `dev`).
- A real SMS provider is required before any production deployment.

The rule is enforced in three places, with one shared function (`isDevOtpProviderEnvironment` in `@finvoice/config`):

1. **Before parsing,** on the raw environment. Configuration validation fails at startup if `AUTH_OTP_PROVIDER` is `dev` (in any spelling) or `AUTH_OTP_DEV_CODE` is set while `NODE_ENV` is anything other than exactly `development` or `test`. Checking the raw value means neither an unset `NODE_ENV` nor an unknown value can slip through a default.
2. **In the cross-field validation** of the parsed configuration.
3. **In the provider factory** (`createOtpDeliveryProvider`). It refuses to build the development provider for any other `nodeEnv`, even for a configuration object that never went through validation.

Errors name the variables, never the code, the pepper or the JWT secret. Tests cover `development` and `test` (allowed), and `production`, `staging`, `preview`, unknown, differently cased and unset values (refused), including on the production build.

Leave `AUTH_OTP_PROVIDER` empty to disable OTP delivery. Sign-in then answers 503.

## 22. Future SMS provider

**Real SMS provider: NOT implemented.**

`AuthService` depends only on the abstract [`OtpDeliveryProvider`](../../apps/api/src/auth/otp-delivery.ts) (`name`, `createCode()`, `deliver({ phoneNumber, code, expiresAt })`). A real provider will extend [`SmsOtpDeliveryProvider`](../../apps/api/src/auth/otp-delivery.ts), whose `createCode()` already returns a random code from the shared generator. Adding one means:

1. implement `deliver()` with the vendor's API;
2. add its name to `OTP_PROVIDERS` and its credentials to `@finvoice/config`;
3. wire it in the `OTP_DELIVERY` factory in `auth.module.ts`.

Requirements for the provider:

- **No logging** of the phone number, the code, the message or the vendor response.
- **Delivery failures** are thrown. The API then discards the challenge and answers `503`, logging only the error class. A test shows this with a failing provider.
- **Only the code** is sent: no other message content from the request.

The integration tests already run the full flow with an SMS-style test double that generates random codes.

## 23. Future voice authentication

Browser voice (Step 7) is **unchanged and anonymous**:

- the gateway's `start_session` accepts no `userId`;
- the voice gateway does not require a user login;
- voice tools cannot read personal data.

A later step will issue a trusted, short-lived voice-session identity from a verified access token, for example through a server-issued session ticket. The gateway will then act for that user through the internal user-context path. A browser will never be able to claim an identity by sending an id.

## 24. Future personalised AI

`POST /api/v1/agent/chat` stays **public and general-purpose**: no `userId`, no personal context, no user-context tools. The trusted user-context tools (`UserContextToolRegistry`, Step 8) are prepared for an authenticated agent. They will be given the identity from `@CurrentUser()` (the verified token), never from the request or from the model.

## 25. Admin authorisation

- **Human administrators are users with `role = ADMIN`.** There is no seeded or automatic administrator, and no existing demo user was promoted. An operator provisions one with a direct, audited database change in the target environment, for example:

  ```sql
  UPDATE users SET role = 'ADMIN' WHERE phone_number = '+94…';
  ```

  The change takes effect at that user's next sign-in or refresh.

- **Admin operations are explicit per endpoint** with `@Roles("ADMIN")`. Today that is only user provisioning.
- **The analytics admin dashboard (Step 10)** still reads `/internal/admin/analytics/*` with `INTERNAL_API_TOKEN` from the Next.js server:
  - **The internal token is not a human admin credential.** It authenticates a FinVoice service, not a person, and must never reach a browser.
  - **Public admin access must use authenticated `ADMIN` authorisation.** No admin analytics route is exposed under `/api/v1` without it.
  - **The dashboard stays disabled by default** (`ADMIN_DASHBOARD_ENABLED=false`) until the web authentication integration connects authenticated admin → Next.js → admin analytics.

## 26. Secret management

| Secret               | Purpose                  | Rules                                                                  |
| -------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `AUTH_JWT_SECRET`    | HS256 signing key        | ≥ 43 characters (32 random bytes, base64url); required in production   |
| `AUTH_OTP_PEPPER`    | OTP HMAC key             | ≥ 43 characters; required in production                                |
| `INTERNAL_API_TOKEN` | Service-to-service token | Separate (Step 7); must differ from both of the above                  |
| `AUTH_OTP_DEV_CODE`  | Development OTP          | Development and test only (exact `NODE_ENV`); rejected everywhere else |

Generate each secret independently:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

- **Where they live:** secrets come from the environment only. For local development that is your own `.env`, which is never committed. In deployments, use a secret store. `.env.example` contains placeholders, never values.
- **No secret appears in** the repository, logs, error messages (configuration errors name the variable, not the value), API responses or the JWT. Tests generate ephemeral secrets inside the test process.
- **Without both secrets, authentication is off.** Sign-in and every protected route answer `503 "Authentication is not configured"`; public routes keep working. Production refuses to start without them.
- **Rotating `AUTH_JWT_SECRET`** invalidates all access tokens immediately; users refresh transparently.
- **Rotating `AUTH_OTP_PEPPER`** invalidates pending OTP challenges only.
- **Refresh tokens** are not derived from either secret.
