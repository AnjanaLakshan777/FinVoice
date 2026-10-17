import type { AuthMeResponse, AuthTokenResponse, UserResponse } from "@finvoice/contracts";

import { AuthClient } from "../../lib/auth/auth-client";

export type RecordedCall = {
  method: string;
  /** Path after /api/v1, including the query string. */
  path: string;
  headers: Record<string, string>;
  body: unknown;
  credentials: RequestCredentials | undefined;
  keepalive: boolean | undefined;
};

export type FakeReply = { status: number; body?: unknown };
type Handler = FakeReply | ((call: RecordedCall) => FakeReply | Promise<FakeReply>);

/**
 * A scripted stand-in for the API behind the same-origin proxy (/api/v1). Routes are matched on
 * method and path without the query string; every call is recorded.
 */
export class FakeApi {
  readonly calls: RecordedCall[] = [];
  readonly #routes = new Map<string, Handler>();

  on(method: string, path: string, handler: Handler): this {
    this.#routes.set(`${method} ${path}`, handler);
    return this;
  }

  callsTo(method: string, path: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method && call.path.split("?")[0] === path);
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^\/api\/v1/u, "");
    const call: RecordedCall = {
      method: init?.method ?? "GET",
      path,
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
      credentials: init?.credentials,
      keepalive: init?.keepalive,
    };
    this.calls.push(call);
    const handler = this.#routes.get(`${call.method} ${path.split("?")[0] ?? ""}`);
    const reply =
      handler === undefined
        ? { status: 404, body: { statusCode: 404, code: "NOT_FOUND", message: "Route not found" } }
        : typeof handler === "function"
          ? await handler(call)
          : handler;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  };

  client(): AuthClient {
    return new AuthClient({ fetch: this.fetch, withLock: null });
  }
}

export const USER_ID = "0190f0a0-0000-7000-8000-000000000001";

export const ME: AuthMeResponse = {
  id: USER_ID,
  preferredLanguage: "SI",
  timezone: "Asia/Colombo",
  role: "USER",
  status: "ACTIVE",
};

export const USER: UserResponse = {
  id: USER_ID,
  displayName: "Kamal",
  preferredLanguage: "SI",
  timezone: "Asia/Colombo",
  status: "ACTIVE",
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
};

export function tokens(accessToken: string): AuthTokenResponse {
  return {
    accessToken,
    tokenType: "Bearer",
    expiresIn: 900,
    user: { id: USER_ID, preferredLanguage: "SI", timezone: "Asia/Colombo", role: "USER" },
  };
}

export function apiError(statusCode: number, code: string, message: string, details?: unknown) {
  return {
    status: statusCode,
    body: { statusCode, code, message, ...(details === undefined ? {} : { details }) },
  };
}

/** A fake API with a live session: refresh succeeds and the Bearer token is checked. */
export function signedInApi(accessToken = "access-token-1"): FakeApi {
  const api = new FakeApi();
  api.on("POST", "/auth/refresh", { status: 200, body: tokens(accessToken) });
  api.on("GET", "/auth/me", (call) =>
    call.headers.authorization === `Bearer ${accessToken}`
      ? { status: 200, body: ME }
      : apiError(401, "UNAUTHORIZED", "Missing or invalid access token"),
  );
  return api;
}
