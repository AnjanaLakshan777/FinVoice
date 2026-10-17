import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, AuthClient, SessionExpiredError } from "../lib/auth/auth-client";
import { apiError, FakeApi, ME, tokens } from "./support/fake-api";

const INVALID_TOKEN = apiError(401, "UNAUTHORIZED", "Missing or invalid access token");
const INVALID_REFRESH = apiError(401, "UNAUTHORIZED", "Invalid or expired refresh token");

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

/** A fake API whose protected route accepts only `valid` as the Bearer token. */
function apiAccepting(valid: string): FakeApi {
  return new FakeApi().on("GET", "/me", (call) =>
    call.headers.authorization === `Bearer ${valid}`
      ? { status: 200, body: { id: "me" } }
      : INVALID_TOKEN,
  );
}

async function signedIn(api: FakeApi, accessToken: string): Promise<AuthClient> {
  api.on("POST", "/auth/guest", { status: 201, body: tokens(accessToken) });
  const client = api.client();
  await client.startGuestSession({ preferredLanguage: "SI" });
  return client;
}

describe("sign-in", () => {
  it("starts a guest session with only the language and name, through the same-origin proxy", async () => {
    const api = new FakeApi().on("POST", "/auth/guest", { status: 201, body: tokens("access-1") });

    const user = await api
      .client()
      .startGuestSession({ preferredLanguage: "TA", displayName: "Kamal" });

    expect(user).toEqual(tokens("access-1").user);
    expect(api.calls).toEqual([
      {
        method: "POST",
        path: "/auth/guest",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: { preferredLanguage: "TA", displayName: "Kamal" },
        credentials: "same-origin",
        keepalive: undefined,
      },
    ]);
  });

  it("keeps the access token only in memory", async () => {
    const api = apiAccepting("access-1");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const log = vi.spyOn(console, "log");

    const client = await signedIn(api, "access-1");
    await client.request("GET", "/me");

    expect(client.hasAccessToken).toBe(true);
    expect(api.callsTo("GET", "/me")[0]?.headers.authorization).toBe("Bearer access-1");
    // Nowhere persistent, and never logged.
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
    expect(log).not.toHaveBeenCalled();
    expect(JSON.stringify(client)).not.toContain("access-1");
    expect(Object.keys(client)).toEqual([]);
  });

  it("reports a refused sign-in as the API's error without storing anything", async () => {
    const api = new FakeApi().on(
      "POST",
      "/auth/guest",
      apiError(429, "TOO_MANY_REQUESTS", "FinVoice is busy. Try again in a minute."),
    );
    const client = api.client();

    const error = await client
      .startGuestSession({ preferredLanguage: "EN" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: "TOO_MANY_REQUESTS" });
    expect(client.hasAccessToken).toBe(false);
  });
});

describe("refresh", () => {
  it("restores a session after a reload: refresh with the cookie, then /auth/me", async () => {
    const api = new FakeApi()
      .on("POST", "/auth/refresh", { status: 200, body: tokens("fresh") })
      .on("GET", "/auth/me", { status: 200, body: ME });
    const client = api.client();

    await expect(client.restoreSession()).resolves.toEqual(ME);

    const [refresh, me] = api.calls;
    // The refresh sends no token and no body: the browser attaches the HttpOnly cookie itself.
    expect(refresh).toMatchObject({ method: "POST", path: "/auth/refresh", body: undefined });
    expect(refresh?.headers.authorization).toBeUndefined();
    expect(refresh?.credentials).toBe("same-origin");
    // Completed (and its rotated cookie stored) even if the page unloads meanwhile.
    expect(refresh?.keepalive).toBe(true);
    expect(me?.headers.authorization).toBe("Bearer fresh");
  });

  it("treats a missing or invalid refresh cookie as signed out, not as an error", async () => {
    const api = new FakeApi().on("POST", "/auth/refresh", INVALID_REFRESH);

    await expect(api.client().restoreSession()).resolves.toBeNull();
    expect(api.callsTo("GET", "/auth/me")).toHaveLength(0);
  });

  it("rejects when the API cannot be reached", async () => {
    const client = new AuthClient({
      fetch: () => Promise.reject(new TypeError("fetch failed")),
      withLock: null,
    });

    await expect(client.restoreSession()).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
    });
  });

  it("refreshes after a 401 and retries the request with the new token", async () => {
    const api = apiAccepting("access-2").on("POST", "/auth/refresh", {
      status: 200,
      body: tokens("access-2"),
    });
    const client = await signedIn(api, "access-1");

    await expect(client.request("GET", "/me")).resolves.toEqual({ id: "me" });

    expect(api.callsTo("POST", "/auth/refresh")).toHaveLength(1);
    expect(api.callsTo("GET", "/me").map((call) => call.headers.authorization)).toEqual([
      "Bearer access-1",
      "Bearer access-2",
    ]);
  });

  it("ends the session when the refresh fails (expired session)", async () => {
    const api = apiAccepting("never").on("POST", "/auth/refresh", INVALID_REFRESH);
    const client = await signedIn(api, "access-1");
    const ended = vi.fn();
    client.onSessionEnd(ended);

    await expect(client.request("GET", "/me")).rejects.toBeInstanceOf(SessionExpiredError);

    expect(ended).toHaveBeenCalledWith("expired");
    expect(client.hasAccessToken).toBe(false);
  });

  it("ends the session if the renewed token is also refused", async () => {
    const api = apiAccepting("never").on("POST", "/auth/refresh", {
      status: 200,
      body: tokens("access-2"),
    });
    const client = await signedIn(api, "access-1");

    await expect(client.request("GET", "/me")).rejects.toBeInstanceOf(SessionExpiredError);
    expect(api.callsTo("POST", "/auth/refresh")).toHaveLength(1);
  });
});

describe("refresh concurrency", () => {
  it("runs one refresh for many simultaneous 401s, and every request reuses the new token", async () => {
    let releaseRefresh: () => void = () => undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const api = apiAccepting("access-2").on("POST", "/auth/refresh", async () => {
      await refreshGate;
      return { status: 200, body: tokens("access-2") };
    });
    const client = await signedIn(api, "access-1");

    const requests = Array.from({ length: 5 }, () => client.request("GET", "/me"));
    await vi.waitFor(() => {
      expect(api.callsTo("POST", "/auth/refresh")).toHaveLength(1);
    });
    releaseRefresh();
    const results = await Promise.all(requests);

    expect(results).toHaveLength(5);
    expect(api.callsTo("POST", "/auth/refresh")).toHaveLength(1);
    const retried = api
      .callsTo("GET", "/me")
      .filter((call) => call.headers.authorization === "Bearer access-2");
    expect(retried).toHaveLength(5);
  });

  it("does not refresh again for a 401 that arrives after another request already refreshed", async () => {
    let firstMe = true;
    let releaseSlow: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const api = new FakeApi()
      .on("GET", "/me", async (call) => {
        if (firstMe) {
          firstMe = false;
          await slow; // Answers 401 only after the other request has refreshed.
        }
        return call.headers.authorization === "Bearer access-2"
          ? { status: 200, body: { id: "me" } }
          : INVALID_TOKEN;
      })
      .on("POST", "/auth/refresh", { status: 200, body: tokens("access-2") });
    const client = await signedIn(api, "access-1");

    const slowRequest = client.request("GET", "/me");
    await client.request("GET", "/me");
    releaseSlow();
    await slowRequest;

    expect(api.callsTo("POST", "/auth/refresh")).toHaveLength(1);
  });

  it("shares one refresh between concurrent restoreSession calls", async () => {
    const api = new FakeApi()
      .on("POST", "/auth/refresh", { status: 200, body: tokens("fresh") })
      .on("GET", "/auth/me", { status: 200, body: ME });
    const client = api.client();

    await Promise.all([client.restoreSession(), client.restoreSession()]);

    expect(api.callsTo("POST", "/auth/refresh")).toHaveLength(1);
  });

  it("serialises refreshes across tabs with a lock when one is available", async () => {
    const lockNames: string[] = [];
    const api = new FakeApi().on("POST", "/auth/refresh", { status: 200, body: tokens("x") });
    const client = new AuthClient({
      fetch: api.fetch,
      withLock: (name, task) => {
        lockNames.push(name);
        return task();
      },
    });

    await client.refresh();

    expect(lockNames).toEqual(["finvoice-auth-refresh"]);
  });
});

describe("logout", () => {
  it("revokes the session through the API with the access token, then forgets the token", async () => {
    const api = new FakeApi().on("POST", "/auth/logout", { status: 204 });
    const client = await signedIn(api, "access-1");
    const ended = vi.fn();
    client.onSessionEnd(ended);

    await client.logout();

    expect(api.callsTo("POST", "/auth/logout")[0]?.headers.authorization).toBe("Bearer access-1");
    expect(client.hasAccessToken).toBe(false);
    expect(ended).toHaveBeenCalledWith("logout");
    // JavaScript never tries to touch the HttpOnly cookie.
    expect(document.cookie).toBe("");
  });

  it("signs out locally even if the API cannot be reached", async () => {
    let online = true;
    const api = new FakeApi().on("POST", "/auth/guest", {
      status: 201,
      body: tokens("access-1"),
    });
    const client = new AuthClient({
      fetch: (input, init) =>
        online ? api.fetch(input, init) : Promise.reject(new TypeError("offline")),
      withLock: null,
    });
    await client.startGuestSession({ preferredLanguage: "EN" });
    online = false;

    await client.logout();

    expect(client.hasAccessToken).toBe(false);
  });

  it("requires a new sign-in afterwards", async () => {
    const api = apiAccepting("access-1")
      .on("POST", "/auth/logout", { status: 204 })
      .on("POST", "/auth/refresh", INVALID_REFRESH);
    const client = await signedIn(api, "access-1");

    await client.logout();

    await expect(client.request("GET", "/me")).rejects.toBeInstanceOf(SessionExpiredError);
  });
});
