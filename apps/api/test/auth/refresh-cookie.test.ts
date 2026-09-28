import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import {
  clearRefreshCookie,
  readRefreshCookie,
  REFRESH_COOKIE_PATH,
  setRefreshCookie,
} from "../../src/auth/refresh-cookie.js";

function fakeResponse() {
  const headers = new Map<string, unknown>();
  return {
    headers,
    response: {
      setHeader: (name: string, value: unknown) => headers.set(name, value),
    } as unknown as ServerResponse,
  };
}

function requestWithCookie(cookie?: string): IncomingMessage {
  return { headers: cookie === undefined ? {} : { cookie } } as IncomingMessage;
}

const settings = { name: "finvoice_refresh", secure: false };

describe("refresh cookie", () => {
  it("is HttpOnly, SameSite=Lax, limited to /api/v1/auth and never cached", () => {
    const { headers, response } = fakeResponse();

    setRefreshCookie(response, settings, "token-value", 2_592_000);

    expect(REFRESH_COOKIE_PATH).toBe("/api/v1/auth");
    expect(headers.get("Set-Cookie")).toBe(
      "finvoice_refresh=token-value; Max-Age=2592000; Path=/api/v1/auth; HttpOnly; SameSite=Lax",
    );
    expect(headers.get("Cache-Control")).toBe("no-store");
  });

  it("is Secure when configured (always in production)", () => {
    const { headers, response } = fakeResponse();

    setRefreshCookie(response, { ...settings, secure: true }, "token-value", 60);

    expect(headers.get("Set-Cookie")).toMatch(/; Secure$/u);
  });

  it("is cleared with an empty value and Max-Age=0 on the same path", () => {
    const { headers, response } = fakeResponse();

    clearRefreshCookie(response, settings);

    expect(headers.get("Set-Cookie")).toBe(
      "finvoice_refresh=; Max-Age=0; Path=/api/v1/auth; HttpOnly; SameSite=Lax",
    );
  });

  it("is read from the Cookie header among other cookies", () => {
    expect(
      readRefreshCookie(requestWithCookie("a=1; finvoice_refresh=abc_DEF-1; b=2"), settings),
    ).toBe("abc_DEF-1");
    expect(readRefreshCookie(requestWithCookie("finvoice_refresh=xyz"), settings)).toBe("xyz");
  });

  it.each([
    undefined,
    "",
    "other=1",
    "finvoice_refresh=",
    "xfinvoice_refresh=abc",
    "finvoice_refreshx=abc",
  ])("is absent for the Cookie header %j", (cookie) => {
    expect(readRefreshCookie(requestWithCookie(cookie), settings)).toBeNull();
  });
});
