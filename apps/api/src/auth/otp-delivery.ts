import { isDevOtpProviderEnvironment, type ApiConfig } from "@finvoice/config";

import { generateOtpCode } from "./auth-crypto.js";

/** What a delivery provider receives: never logged, never stored. */
export type OtpDelivery = {
  /** E.164 phone number. */
  phoneNumber: string;
  code: string;
  expiresAt: Date;
};

/**
 * How one-time codes are chosen and delivered. AuthService depends only on this abstraction, so a
 * real SMS provider can be added later without changing it.
 *
 * Implementations must never log, store or return the code or the phone number.
 */
export abstract class OtpDeliveryProvider {
  /** A short, non-secret name for diagnostics ("dev", later e.g. "sms"). */
  abstract readonly name: string;
  /** The code for a new challenge. */
  abstract createCode(): string;
  /** Sends the code to the phone. Throws if it could not be handed over for delivery. */
  abstract deliver(delivery: OtpDelivery): Promise<void>;
}

/**
 * DEVELOPMENT AND TEST ONLY (AUTH_OTP_PROVIDER=dev; allowed only when NODE_ENV is exactly
 * "development" or "test", by configuration validation and by createOtpDeliveryProvider). Every
 * challenge uses the fixed AUTH_OTP_DEV_CODE, which the developer knows from their own .env, and
 * nothing is sent anywhere: the code is not logged, returned or stored in plaintext. This lets
 * authentication be tested end to end without an SMS provider.
 */
export class DevOtpDeliveryProvider extends OtpDeliveryProvider {
  readonly name = "dev";

  constructor(private readonly code: string) {
    super();
  }

  createCode(): string {
    return this.code;
  }

  deliver(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * The configured provider, or null when none is configured (sign-in then answers 503).
 *
 * The development provider is built only when NODE_ENV is exactly "development" or "test": the
 * same allowlist as configuration validation (isDevOtpProviderEnvironment), checked again here so
 * that a configuration object that bypassed validation still cannot enable it. The error never
 * contains the code.
 */
export function createOtpDeliveryProvider(
  config: Pick<ApiConfig, "nodeEnv" | "auth">,
): OtpDeliveryProvider | null {
  const { provider, devCode } = config.auth.otp;
  if (provider !== "dev") {
    return null;
  }
  if (!isDevOtpProviderEnvironment(config.nodeEnv)) {
    throw new Error(
      "The development OTP provider is allowed only when NODE_ENV is development or test",
    );
  }
  if (devCode === null) {
    throw new Error("The development OTP provider needs AUTH_OTP_DEV_CODE");
  }
  return new DevOtpDeliveryProvider(devCode);
}

/**
 * The contract a real SMS provider will implement (NOT implemented in this step: no vendor is
 * integrated). It must use a random code from generateOtpCode() and send it through the vendor's
 * API, without logging the phone number, the code or the vendor's response.
 */
export abstract class SmsOtpDeliveryProvider extends OtpDeliveryProvider {
  createCode(): string {
    return generateOtpCode();
  }
}
