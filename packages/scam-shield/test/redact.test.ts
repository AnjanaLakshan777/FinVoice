import { afterEach, describe, expect, it, vi } from "vitest";

import { analyzeScam, redactSensitiveText } from "../src/index.js";

describe("redactSensitiveText", () => {
  it.each([
    ["an e-mail address", "Reply to fake.agent@example.com today", "Reply to [email] today"],
    ["a web address", "Open https://bit.ly/3abc now", "Open [link] now"],
    ["a bare host", "Visit secure-login.xyz/verify now", "Visit [link] now"],
    ["a card number", "Card 4111 1111 1111 1111 expired", "Card [card number] expired"],
    ["a Sri Lankan phone number", "Call +94 77 123 4567 or 0771234567", "Call [phone] or [phone]"],
    ["an OTP-like code", "Your code 482913 expires", "Your code [redacted] expires"],
    ["a bare OTP-like number", "It was 4829 I think", "It was [code] I think"],
    ["a labelled password", "password: hunter2!", "password: [redacted]"],
    ["a labelled PIN", "my PIN is 1234", "my PIN is [redacted]"],
    ["a Sinhala labelled password", "මුරපදය: abc123", "මුරපදය: [redacted]"],
  ])("redacts %s", (_case, input, expected) => {
    expect(redactSensitiveText(input)).toBe(expected);
  });

  it("leaves ordinary text alone", () => {
    expect(redactSensitiveText("The meeting is on Monday at the branch.")).toBe(
      "The meeting is on Monday at the branch.",
    );
  });
});

describe("engine isolation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes no network call and writes nothing to the console", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    analyzeScam({
      content: "Click https://bit.ly/abc and send your OTP to secret@example.com now.",
      language: "EN",
      sourceType: "MESSAGE",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
