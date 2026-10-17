import { describe, expect, it } from "vitest";

import {
  ConfigValidationError,
  DEFAULT_GEMINI_LIVE_MODEL,
  DEFAULT_GEMINI_LIVE_VOICE,
  loadAdminDashboardConfig,
  loadApiConfig,
  loadDatabaseConfig,
  loadVoiceGatewayConfig,
} from "../src/index.js";

// Fake credentials for tests only.
const DATABASE_URL = "postgresql://finvoice:not-a-real-secret@localhost:5432/finvoice";

const JWT_SECRET = "j".repeat(43);

describe("loadApiConfig", () => {
  it("applies local development defaults", () => {
    expect(loadApiConfig({ DATABASE_URL })).toEqual({
      nodeEnv: "development",
      host: "127.0.0.1",
      port: 4000,
      database: { url: DATABASE_URL },
      gemini: { apiKey: null, model: "gemini-3.8-flash" },
      internal: { token: null },
      analytics: { retentionDays: 90 },
      auth: {
        enabled: false,
        jwtSecret: null,
        accessTokenTtlSeconds: 900,
        refreshTokenTtlDays: 30,
        guest: { limit: 30, windowSeconds: 60 },
        refreshCookie: { name: "finvoice_refresh", secure: false },
      },
    });
  });

  it("reads and coerces provided values", () => {
    expect(
      loadApiConfig({
        NODE_ENV: "production",
        API_HOST: "0.0.0.0",
        API_PORT: "8080",
        DATABASE_URL,
        AUTH_JWT_SECRET: JWT_SECRET,
      }),
    ).toEqual({
      nodeEnv: "production",
      host: "0.0.0.0",
      port: 8080,
      database: { url: DATABASE_URL },
      gemini: { apiKey: null, model: "gemini-3.8-flash" },
      internal: { token: null },
      analytics: { retentionDays: 90 },
      auth: {
        enabled: true,
        jwtSecret: JWT_SECRET,
        accessTokenTtlSeconds: 900,
        refreshTokenTtlDays: 30,
        guest: { limit: 30, windowSeconds: 60 },
        refreshCookie: { name: "finvoice_refresh", secure: true },
      },
    });
  });

  it("reads the Gemini settings and treats an empty key as not set", () => {
    const fakeKey = "fake-gemini-key-for-tests";

    expect(
      loadApiConfig({ DATABASE_URL, GEMINI_API_KEY: fakeKey, GEMINI_MODEL: "gemini-test-model" })
        .gemini,
    ).toEqual({ apiKey: fakeKey, model: "gemini-test-model" });
    expect(loadApiConfig({ DATABASE_URL, GEMINI_API_KEY: "  " }).gemini.apiKey).toBeNull();
  });

  it("rejects an invalid model name without echoing the key", () => {
    let error: unknown;
    try {
      loadApiConfig({
        DATABASE_URL,
        GEMINI_API_KEY: "secret-key-value",
        GEMINI_MODEL: "bad model!",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigValidationError);
    expect((error as Error).message).toMatch(/GEMINI_MODEL/);
    expect((error as Error).message).not.toContain("secret-key-value");
  });

  it("rejects an invalid port", () => {
    expect(() => loadApiConfig({ API_PORT: "not-a-port", DATABASE_URL })).toThrow(
      ConfigValidationError,
    );
  });

  it("requires DATABASE_URL", () => {
    expect(() => loadApiConfig({})).toThrow(/Required[\s\S]*DATABASE_URL/);
  });
});

describe("loadDatabaseConfig", () => {
  it("accepts postgres:// and postgresql:// URLs", () => {
    expect(loadDatabaseConfig({ DATABASE_URL }).url).toBe(DATABASE_URL);
    expect(loadDatabaseConfig({ DATABASE_URL: "postgres://u:p@db:5432/x" }).url).toBe(
      "postgres://u:p@db:5432/x",
    );
  });

  it("rejects a non-PostgreSQL URL without echoing it", () => {
    const secretUrl = "mysql://finvoice:do-not-print-me@localhost:3306/finvoice";

    let error: unknown;
    try {
      loadDatabaseConfig({ DATABASE_URL: secretUrl });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigValidationError);
    expect((error as Error).message).toMatch(/DATABASE_URL/);
    expect((error as Error).message).not.toContain("do-not-print-me");
  });
});

describe("internal API token", () => {
  const token = "t".repeat(32);

  it("is optional for the API and read when set", () => {
    expect(loadApiConfig({ DATABASE_URL, INTERNAL_API_TOKEN: token }).internal).toEqual({ token });
    expect(loadApiConfig({ DATABASE_URL, INTERNAL_API_TOKEN: "" }).internal.token).toBeNull();
  });

  it("rejects a short token without echoing it", () => {
    let error: unknown;
    try {
      loadApiConfig({ DATABASE_URL, INTERNAL_API_TOKEN: "short-secret-value" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigValidationError);
    expect((error as Error).message).toMatch(/INTERNAL_API_TOKEN/);
    expect((error as Error).message).not.toContain("short-secret-value");
  });
});

describe("loadVoiceGatewayConfig", () => {
  it("applies local development defaults", () => {
    expect(loadVoiceGatewayConfig({})).toEqual({
      nodeEnv: "development",
      host: "127.0.0.1",
      port: 4100,
      allowedOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
      maxSessions: 10,
      gemini: {
        apiKey: null,
        liveModel: DEFAULT_GEMINI_LIVE_MODEL,
        liveVoice: DEFAULT_GEMINI_LIVE_VOICE,
      },
      internalApi: { url: "http://127.0.0.1:4000", token: null },
    });
    expect(DEFAULT_GEMINI_LIVE_MODEL).toBe("gemini-3.8-live");
    expect(DEFAULT_GEMINI_LIVE_VOICE).toBe("Kore");
  });

  it("reads provided values", () => {
    const token = "g".repeat(40);
    expect(
      loadVoiceGatewayConfig({
        VOICE_GATEWAY_PORT: "4200",
        VOICE_WEB_ORIGIN: " https://finvoice.example , http://localhost:3001 ",
        VOICE_MAX_SESSIONS: "3",
        GEMINI_API_KEY: "fake-gemini-key-for-tests",
        GEMINI_LIVE_MODEL: "gemini-live-test",
        GEMINI_LIVE_VOICE: "Puck",
        INTERNAL_API_URL: "http://api.internal:4000/",
        INTERNAL_API_TOKEN: token,
      }),
    ).toMatchObject({
      port: 4200,
      allowedOrigins: ["https://finvoice.example", "http://localhost:3001"],
      maxSessions: 3,
      gemini: {
        apiKey: "fake-gemini-key-for-tests",
        liveModel: "gemini-live-test",
        liveVoice: "Puck",
      },
      internalApi: { url: "http://api.internal:4000", token },
    });
  });

  it.each([
    ["a wildcard origin", "*"],
    ["an origin with a path", "http://localhost:3000/voice"],
    ["a non-http origin", "ws://localhost:3000"],
    ["an empty list", " , "],
  ])("rejects %s in VOICE_WEB_ORIGIN", (_case, value) => {
    expect(() => loadVoiceGatewayConfig({ VOICE_WEB_ORIGIN: value })).toThrow(
      ConfigValidationError,
    );
  });

  it("rejects an invalid Live model name without echoing the key", () => {
    let error: unknown;
    try {
      loadVoiceGatewayConfig({
        GEMINI_API_KEY: "secret-key-value",
        GEMINI_LIVE_MODEL: "bad model",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigValidationError);
    expect((error as Error).message).toMatch(/GEMINI_LIVE_MODEL/);
    expect((error as Error).message).not.toContain("secret-key-value");
  });

  it.each(["", "Kore; rm", "a", "Kore Puck", "x".repeat(41)])(
    "rejects the voice name %j",
    (voice) => {
      expect(() => loadVoiceGatewayConfig({ GEMINI_LIVE_VOICE: voice })).toThrow(
        ConfigValidationError,
      );
    },
  );

  it("rejects an unknown NODE_ENV", () => {
    expect(() => loadVoiceGatewayConfig({ NODE_ENV: "staging" })).toThrow(ConfigValidationError);
  });
});

describe("analytics retention", () => {
  const DATABASE_URL = "postgresql://user:secret@localhost:5432/finvoice";

  it("defaults to 90 days and accepts a configured value", () => {
    expect(loadApiConfig({ DATABASE_URL }).analytics.retentionDays).toBe(90);
    expect(
      loadApiConfig({ DATABASE_URL, ANALYTICS_RETENTION_DAYS: "30" }).analytics.retentionDays,
    ).toBe(30);
  });

  it.each(["0", "-5", "1.5", "abc", "3651"])("rejects ANALYTICS_RETENTION_DAYS=%s", (value) => {
    expect(() => loadApiConfig({ DATABASE_URL, ANALYTICS_RETENTION_DAYS: value })).toThrow(
      ConfigValidationError,
    );
  });
});

describe("loadAdminDashboardConfig", () => {
  const TOKEN = "t".repeat(40);

  it("is disabled by default, with the local API URL and no token", () => {
    expect(loadAdminDashboardConfig({})).toEqual({
      enabled: false,
      internalApi: { url: "http://127.0.0.1:4000", token: null },
    });
  });

  it("reads explicit settings", () => {
    expect(
      loadAdminDashboardConfig({
        ADMIN_DASHBOARD_ENABLED: "true",
        INTERNAL_API_URL: "http://api.internal:4000/",
        INTERNAL_API_TOKEN: TOKEN,
      }),
    ).toEqual({ enabled: true, internalApi: { url: "http://api.internal:4000", token: TOKEN } });
  });

  it.each(["yes", "1", "TRUE", "on"])(
    "rejects ADMIN_DASHBOARD_ENABLED=%s instead of guessing",
    (value) => {
      expect(() => loadAdminDashboardConfig({ ADMIN_DASHBOARD_ENABLED: value })).toThrow(
        ConfigValidationError,
      );
    },
  );

  it("never echoes the token in validation errors", () => {
    const short = "short-secret-value";
    try {
      loadAdminDashboardConfig({ INTERNAL_API_TOKEN: short });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(short);
    }
  });
});

describe("authentication configuration", () => {
  const DATABASE_URL = "postgresql://user:secret@localhost:5432/finvoice";
  const PRODUCTION = {
    NODE_ENV: "production",
    DATABASE_URL,
    AUTH_JWT_SECRET: JWT_SECRET,
  };

  function problems(env: Record<string, string>): string {
    try {
      loadApiConfig(env);
      return "";
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      return String(error);
    }
  }

  it("enables authentication only when the JWT secret is set", () => {
    expect(loadApiConfig({ DATABASE_URL }).auth.enabled).toBe(false);
    expect(loadApiConfig({ DATABASE_URL, AUTH_JWT_SECRET: JWT_SECRET }).auth.enabled).toBe(true);
  });

  it("requires the JWT secret in production", () => {
    expect(problems({ NODE_ENV: "production", DATABASE_URL })).toContain("AUTH_JWT_SECRET");
  });

  it("requires a Secure refresh cookie in production", () => {
    expect(problems({ ...PRODUCTION, AUTH_REFRESH_COOKIE_SECURE: "false" })).toContain(
      "AUTH_REFRESH_COOKIE_SECURE",
    );
    expect(loadApiConfig(PRODUCTION).auth.refreshCookie.secure).toBe(true);
    // Empty means "not set": the environment's default.
    expect(
      loadApiConfig({ ...PRODUCTION, AUTH_REFRESH_COOKIE_SECURE: "" }).auth.refreshCookie.secure,
    ).toBe(true);
    expect(
      loadApiConfig({ DATABASE_URL, AUTH_REFRESH_COOKIE_SECURE: "" }).auth.refreshCookie.secure,
    ).toBe(false);
    expect(
      loadApiConfig({ DATABASE_URL, AUTH_REFRESH_COOKIE_SECURE: "true" }).auth.refreshCookie.secure,
    ).toBe(true);
    expect(problems({ DATABASE_URL, AUTH_REFRESH_COOKIE_SECURE: "yes" })).toContain(
      "AUTH_REFRESH_COOKIE_SECURE",
    );
  });

  it("reads the guest-session rate limit", () => {
    expect(
      loadApiConfig({
        DATABASE_URL,
        AUTH_GUEST_SESSION_LIMIT: "5",
        AUTH_GUEST_SESSION_WINDOW_SECONDS: "120",
      }).auth.guest,
    ).toEqual({ limit: 5, windowSeconds: 120 });
  });

  it("ignores leftover OTP settings from older environment files", () => {
    const config = loadApiConfig({
      ...PRODUCTION,
      AUTH_OTP_PEPPER: "p".repeat(43),
      AUTH_OTP_PROVIDER: "dev",
      AUTH_OTP_DEV_CODE: "12345678",
    });
    expect(config.auth.enabled).toBe(true);
    expect(JSON.stringify(config.auth)).not.toContain("12345678");
  });

  it("rejects a short secret without echoing it", () => {
    const weak = "short-but-secret-value";
    const message = problems({ DATABASE_URL, AUTH_JWT_SECRET: weak });
    expect(message).toContain("AUTH_JWT_SECRET");
    expect(message).not.toContain(weak);
  });

  it("keeps the JWT secret and the internal token different", () => {
    const message = problems({
      DATABASE_URL,
      AUTH_JWT_SECRET: JWT_SECRET,
      INTERNAL_API_TOKEN: JWT_SECRET,
    });
    expect(message).toContain("INTERNAL_API_TOKEN");
    expect(message).not.toContain(JWT_SECRET);
  });

  it.each([
    ["AUTH_ACCESS_TOKEN_TTL_SECONDS", "-1"],
    ["AUTH_ACCESS_TOKEN_TTL_SECONDS", "0"],
    ["AUTH_REFRESH_TOKEN_TTL_DAYS", "0"],
    ["AUTH_GUEST_SESSION_LIMIT", "0"],
    ["AUTH_GUEST_SESSION_WINDOW_SECONDS", "abc"],
    ["AUTH_REFRESH_COOKIE_NAME", "bad name;"],
  ])("rejects %s=%s", (name, value) => {
    expect(problems({ DATABASE_URL, [name]: value })).toContain(name);
  });
});
