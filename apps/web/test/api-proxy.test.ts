import { describe, expect, it, vi } from "vitest";

import {
  API_PROXY_MAX_BODY_BYTES,
  apiBaseUrl,
  DEFAULT_API_URL,
  proxyApiRequest,
} from "../lib/server/api-proxy";

const API = "http://api.internal:4000";
const REFRESH_COOKIE =
  "finvoice_refresh=abc_DEF-123; Max-Age=2592000; Path=/api/v1/auth; HttpOnly; SameSite=Lax";

type Forwarded = { url: string; init: RequestInit };

function upstream(reply: () => Response | Promise<Response>): {
  fetch: typeof fetch;
  forwarded: Forwarded[];
} {
  const forwarded: Forwarded[] = [];
  return {
    forwarded,
    fetch: async (input, init) => {
      forwarded.push({ url: input as string, init: init ?? {} });
      return reply();
    },
  };
}

function browserRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://finvoice.example${path}`, init);
}

describe("same-origin API proxy", () => {
  it("forwards /api/v1 requests with the method, path, query and body", async () => {
    const api = upstream(() => Response.json({ data: [] }, { status: 200 }));

    const response = await proxyApiRequest(
      browserRequest("/api/v1/me/goals?status=ACTIVE&limit=5", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer t" },
        body: JSON.stringify({ name: "Bicycle" }),
      }),
      ["me", "goals"],
      API,
      api.fetch,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
    const [call] = api.forwarded;
    expect(call?.url).toBe(`${API}/api/v1/me/goals?status=ACTIVE&limit=5`);
    expect(call?.init.method).toBe("POST");
    expect(new TextDecoder().decode(call?.init.body as ArrayBuffer)).toBe('{"name":"Bicycle"}');
    expect(call?.init.redirect).toBe("manual");
  });

  it("forwards only the headers the API needs: never IPs, internal tokens or other cookies", async () => {
    const api = upstream(() => new Response(null, { status: 204 }));

    await proxyApiRequest(
      browserRequest("/api/v1/me", {
        headers: {
          authorization: "Bearer t",
          accept: "application/json",
          cookie: "finvoice_refresh=abc; other=1",
          "x-finvoice-internal-token": "a-stolen-token",
          "x-forwarded-for": "203.0.113.9",
          "user-agent": "Browser/1.0",
        },
      }),
      ["me"],
      API,
      api.fetch,
    );

    const headers = new Headers(api.forwarded[0]?.init.headers);
    expect([...headers.keys()].sort()).toEqual(["accept", "authorization"]);
  });

  it("forwards the Cookie header to /api/v1/auth/* only (the refresh cookie's path)", async () => {
    const api = upstream(() => Response.json({}, { status: 200 }));

    await proxyApiRequest(
      browserRequest("/api/v1/auth/refresh", {
        method: "POST",
        headers: { cookie: "finvoice_refresh=abc" },
      }),
      ["auth", "refresh"],
      API,
      api.fetch,
    );

    expect(new Headers(api.forwarded[0]?.init.headers).get("cookie")).toBe("finvoice_refresh=abc");
  });

  it("passes every Set-Cookie through unchanged, so the refresh cookie stays HttpOnly", async () => {
    const api = upstream(() => {
      const headers = new Headers({
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      headers.append("set-cookie", REFRESH_COOKIE);
      headers.append("set-cookie", "second=1; Path=/api/v1/auth; HttpOnly");
      headers.set("x-internal-detail", "should-not-leak");
      return new Response('{"accessToken":"t"}', { status: 200, headers });
    });

    const response = await proxyApiRequest(
      browserRequest("/api/v1/auth/guest", { method: "POST", body: "{}" }),
      ["auth", "guest"],
      API,
      api.fetch,
    );

    expect(response.headers.getSetCookie()).toEqual([
      REFRESH_COOKIE,
      "second=1; Path=/api/v1/auth; HttpOnly",
    ]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-internal-detail")).toBeNull();
  });

  it("keeps the API's status, error body and WWW-Authenticate header", async () => {
    const body = {
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Missing or invalid access token",
    };
    const api = upstream(() =>
      Response.json(body, { status: 401, headers: { "www-authenticate": "Bearer" } }),
    );

    const response = await proxyApiRequest(browserRequest("/api/v1/me"), ["me"], API, api.fetch);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await response.json()).toEqual(body);
  });

  it("returns an empty 204 as-is", async () => {
    const api = upstream(() => new Response(null, { status: 204 }));

    const response = await proxyApiRequest(
      browserRequest("/api/v1/auth/logout", { method: "POST" }),
      ["auth", "logout"],
      API,
      api.fetch,
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it.each([
    [[".."]],
    [["..", "internal", "users"]],
    [["me", ".", "goals"]],
    [[""]],
    [["a/b"]],
    [["a\\b"]],
    [[]],
  ])(
    "refuses the path segments %j without calling the API (no escape from /api/v1)",
    async (path) => {
      const fetchSpy = vi.fn<typeof fetch>();

      const response = await proxyApiRequest(browserRequest("/api/v1/x"), path, API, fetchSpy);

      expect(response.status).toBe(404);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("encodes path segments, so they cannot add query strings or path parts", async () => {
    const api = upstream(() => Response.json({}, { status: 404 }));

    await proxyApiRequest(browserRequest("/api/v1/x"), ["me", "goals", "a?b=c#d"], API, api.fetch);

    expect(api.forwarded[0]?.url).toBe(`${API}/api/v1/me/goals/a%3Fb%3Dc%23d`);
  });

  it("answers 503 in the API error format when the API is unreachable, without details", async () => {
    const response = await proxyApiRequest(browserRequest("/api/v1/me"), ["me"], API, () =>
      Promise.reject(new Error(`connect ECONNREFUSED ${API}`)),
    );

    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      statusCode: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "The FinVoice API is not available",
    });
    expect(text).not.toContain("api.internal");
  });

  it("answers 503 when no valid API URL is configured", async () => {
    const response = await proxyApiRequest(browserRequest("/api/v1/me"), ["me"], null, vi.fn());

    expect(response.status).toBe(503);
  });

  it("refuses oversized bodies before forwarding", async () => {
    const fetchSpy = vi.fn<typeof fetch>();

    const response = await proxyApiRequest(
      browserRequest("/api/v1/me", {
        method: "PATCH",
        body: "x".repeat(API_PROXY_MAX_BODY_BYTES + 1),
      }),
      ["me"],
      API,
      fetchSpy,
    );

    expect(response.status).toBe(413);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads the API URL from INTERNAL_API_URL, defaulting to the local API", () => {
    expect(
      apiBaseUrl({ INTERNAL_API_URL: "https://api.example.com/" } as unknown as NodeJS.ProcessEnv),
    ).toBe("https://api.example.com");
    expect(apiBaseUrl({} as unknown as NodeJS.ProcessEnv)).toBe(DEFAULT_API_URL);
    expect(apiBaseUrl({ INTERNAL_API_URL: "ftp://x" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(
      apiBaseUrl({ INTERNAL_API_URL: "not a url" } as unknown as NodeJS.ProcessEnv),
    ).toBeNull();
  });
});
