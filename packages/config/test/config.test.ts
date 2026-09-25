import { describe, expect, it } from "vitest";

import {
  ConfigValidationError,
  loadApiConfig,
  loadDatabaseConfig,
  loadVoiceGatewayConfig,
} from "../src/index.js";

// Fake credentials for tests only.
const DATABASE_URL = "postgresql://finvoice:not-a-real-secret@localhost:5432/finvoice";

describe("loadApiConfig", () => {
  it("applies local development defaults", () => {
    expect(loadApiConfig({ DATABASE_URL })).toEqual({
      nodeEnv: "development",
      host: "127.0.0.1",
      port: 4000,
      database: { url: DATABASE_URL },
    });
  });

  it("reads and coerces provided values", () => {
    expect(
      loadApiConfig({
        NODE_ENV: "production",
        API_HOST: "0.0.0.0",
        API_PORT: "8080",
        DATABASE_URL,
      }),
    ).toEqual({
      nodeEnv: "production",
      host: "0.0.0.0",
      port: 8080,
      database: { url: DATABASE_URL },
    });
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

describe("loadVoiceGatewayConfig", () => {
  it("applies local development defaults", () => {
    expect(loadVoiceGatewayConfig({})).toEqual({
      nodeEnv: "development",
      host: "127.0.0.1",
      port: 4100,
    });
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => loadVoiceGatewayConfig({ NODE_ENV: "staging" })).toThrow(ConfigValidationError);
  });
});
