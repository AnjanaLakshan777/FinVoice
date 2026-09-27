import { describe, expect, it, vi } from "vitest";

import { HttpVoiceBackend, VoiceBackendError } from "../src/backend/voice-backend.js";

const TOKEN = "internal-test-token-0123456789-abcdef";

function backend(fetchImpl: typeof fetch, token: string | null = TOKEN) {
  return new HttpVoiceBackend({ url: "http://api.test", token }, fetchImpl);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("HttpVoiceBackend", () => {
  it("gets the session setup with the internal token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(json(200, { language: "TA" })));

    await expect(backend(fetchImpl).getSessionSetup("TA")).resolves.toEqual({ language: "TA" });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("http://api.test/internal/voice/session-setup?language=TA");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>)["x-finvoice-internal-token"]).toBe(TOKEN);
  });

  it("posts tool calls as JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(json(200, { tool: "calculate_loan", isError: false, result: {} })),
    );
    const request = {
      name: "calculate_loan",
      arguments: { termMonths: 36 },
      language: "EN" as const,
    };

    await backend(fetchImpl).executeTool(request);

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("http://api.test/internal/voice/tools/execute");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify(request));
  });

  it("fails as not_configured without a token, without calling the API", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(backend(fetchImpl, null).getSessionSetup("EN")).rejects.toMatchObject({
      failure: "not_configured",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, "not_configured"],
    [503, "unavailable"],
    [500, "unavailable"],
    [400, "unavailable"],
  ])("maps HTTP %i to %s", async (status, failure) => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(json(status, { code: "X" })));
    const error: unknown = await backend(fetchImpl)
      .getSessionSetup("EN")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(VoiceBackendError);
    expect(error).toMatchObject({ failure, status });
  });

  it("maps network errors to unavailable without the token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("fetch failed")));
    const error: unknown = await backend(fetchImpl)
      .getSessionSetup("EN")
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ failure: "unavailable" });
    expect(String(error)).not.toContain(TOKEN);
  });
});
