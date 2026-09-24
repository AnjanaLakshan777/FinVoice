import { describe, expect, it } from "vitest";

import { ConfigValidationError, loadApiConfig, loadVoiceGatewayConfig } from "../src/index.js";

describe("loadApiConfig", () => {
  it("applies local development defaults", () => {
    expect(loadApiConfig({})).toEqual({ nodeEnv: "development", host: "127.0.0.1", port: 4000 });
  });

  it("reads and coerces provided values", () => {
    expect(
      loadApiConfig({ NODE_ENV: "production", API_HOST: "0.0.0.0", API_PORT: "8080" }),
    ).toEqual({ nodeEnv: "production", host: "0.0.0.0", port: 8080 });
  });

  it("rejects an invalid port", () => {
    expect(() => loadApiConfig({ API_PORT: "not-a-port" })).toThrow(ConfigValidationError);
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
