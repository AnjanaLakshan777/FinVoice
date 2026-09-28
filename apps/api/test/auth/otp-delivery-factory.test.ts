import type { ApiConfig } from "@finvoice/config";
import { describe, expect, it } from "vitest";

import { createOtpDeliveryProvider, DevOtpDeliveryProvider } from "../../src/auth/otp-delivery.js";
import { testAuthConfig } from "../support/auth.js";

/**
 * The factory must enforce the development/test-only rule on its own, even for a configuration
 * object that never went through validation (for example one built by hand).
 */
function configFor(nodeEnv: string, auth = testAuthConfig()) {
  return { nodeEnv, auth } as unknown as Pick<ApiConfig, "nodeEnv" | "auth">;
}

describe("createOtpDeliveryProvider", () => {
  it.each(["development", "test"])("builds the development provider for NODE_ENV=%s", (nodeEnv) => {
    const auth = testAuthConfig();

    const provider = createOtpDeliveryProvider(configFor(nodeEnv, auth));

    expect(provider).toBeInstanceOf(DevOtpDeliveryProvider);
    expect(provider?.createCode()).toBe(auth.otp.devCode);
  });

  it.each(["production", "staging", "preview", "qa", "Development", " test", ""])(
    "refuses the development provider for NODE_ENV=%j, without revealing the code or secrets",
    (nodeEnv) => {
      const auth = testAuthConfig();

      let message = "";
      try {
        createOtpDeliveryProvider(configFor(nodeEnv, auth));
      } catch (error) {
        message = String(error);
      }

      expect(message).toContain(
        "The development OTP provider is allowed only when NODE_ENV is development or test",
      );
      for (const secret of [auth.otp.devCode, auth.jwtSecret, auth.otpPepper]) {
        expect(message).not.toContain(secret);
      }
    },
  );

  it("refuses the development provider without its code", () => {
    const auth = testAuthConfig();

    expect(() =>
      createOtpDeliveryProvider(
        configFor("development", { ...auth, otp: { ...auth.otp, devCode: null } }),
      ),
    ).toThrow("The development OTP provider needs AUTH_OTP_DEV_CODE");
  });

  it("returns no provider when none is configured, in every environment", () => {
    const auth = testAuthConfig();
    const none = { ...auth, otp: { ...auth.otp, provider: null, devCode: null } };

    for (const nodeEnv of ["development", "test", "production", "staging"]) {
      expect(createOtpDeliveryProvider(configFor(nodeEnv, none))).toBeNull();
    }
  });
});
