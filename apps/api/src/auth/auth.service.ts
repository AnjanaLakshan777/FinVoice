import type { ApiConfig } from "@finvoice/config";
import {
  AUTH_ERROR_MESSAGES,
  REQUEST_OTP_MESSAGE,
  type AuthMeResponse,
  type AuthTokenResponse,
  type AuthUser,
  type RequestOtpResponse,
  type VerifyOtpCommand,
} from "@finvoice/contracts";
import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";

import { ApiException, apiError } from "../common/api.exception.js";
import { isPrismaError } from "../common/prisma-errors.js";
import { API_CONFIG } from "../config/api-config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import type { User } from "../generated/prisma/client.js";
import { AccessTokenService } from "./access-token.service.js";
import { authenticationNotConfigured } from "./auth.guards.js";
import type { AuthenticatedUser } from "./auth.types.js";
import { OtpChallengeService } from "./otp-challenge.service.js";
import { OtpDeliveryProvider } from "./otp-delivery.js";
import { SessionService, type IssuedSession } from "./session.service.js";

/** Injection token of the configured OtpDeliveryProvider, or null when none is configured. */
export const OTP_DELIVERY = Symbol("OTP_DELIVERY");

/** A completed sign-in or refresh: the JSON body, and the refresh token for the cookie. */
export type SignInResult = { body: AuthTokenResponse; session: IssuedSession };

/**
 * Phone-OTP sign-in, refresh and identity. See docs/architecture/authentication-authorization.md.
 *
 * Nothing here logs or returns a code, a token, a phone number or a secret. All verification
 * failures share one generic message, so responses never reveal whether a number has an account.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly challenges: OtpChallengeService,
    private readonly sessions: SessionService,
    private readonly tokens: AccessTokenService,
    @Inject(OTP_DELIVERY) private readonly delivery: OtpDeliveryProvider | null,
    @Inject(API_CONFIG) config: ApiConfig,
  ) {
    this.enabled = config.auth.enabled;
  }

  get refreshTokenTtlSeconds(): number {
    return this.sessions.ttlSeconds;
  }

  /**
   * Starts a sign-in. Deliberately does not look the number up: the answer is identical for
   * registered, unregistered and inactive numbers (the only differences are 400 for a malformed
   * number and 429 for too many requests, both independent of any account).
   */
  async requestOtp(phoneNumber: string): Promise<RequestOtpResponse> {
    const delivery = this.requireDelivery();
    const challenge = await this.challenges.create(phoneNumber, delivery.createCode());
    try {
      await delivery.deliver({
        phoneNumber,
        code: challenge.code,
        expiresAt: challenge.expiresAt,
      });
    } catch (error) {
      await this.challenges.abandon(challenge.challengeId);
      // The error class only: a provider's message could contain the number or the code.
      this.logger.error(
        `OTP delivery failed (${error instanceof Error ? error.name : "unknown error"})`,
      );
      throw new ApiException(
        apiError(
          HttpStatus.SERVICE_UNAVAILABLE,
          "SERVICE_UNAVAILABLE",
          AUTH_ERROR_MESSAGES.otpDeliveryFailed,
        ),
      );
    }
    return {
      challengeId: challenge.challengeId,
      expiresIn: this.challenges.ttlSeconds,
      message: REQUEST_OTP_MESSAGE,
    };
  }

  /**
   * Completes a sign-in: verifies and consumes the code, then signs in the phone's user, creating
   * it (role USER, status ACTIVE) if the number is new. displayName and preferredLanguage are used
   * only for a new account. An inactive account gets the same kind of generic 401.
   */
  async verifyOtp(command: VerifyOtpCommand): Promise<SignInResult> {
    this.requireEnabled();
    const phoneNumber = await this.challenges.verify(command.challengeId, command.code);
    if (phoneNumber === null) {
      throw verificationFailed();
    }
    const user = await this.findOrCreateUser(phoneNumber, command);
    if (user.status !== "ACTIVE") {
      throw authenticationFailed();
    }
    const session = await this.sessions.start(user.id);
    return { body: await this.tokenResponse(user, session.sessionId), session };
  }

  /** Rotates the refresh token (see SessionService). Every failure is the same 401. */
  async refresh(refreshToken: string | null): Promise<SignInResult> {
    this.requireEnabled();
    const result = refreshToken === null ? null : await this.sessions.refresh(refreshToken);
    if (!result?.ok) {
      throw invalidRefreshToken();
    }
    return {
      body: await this.tokenResponse(result.user, result.session.sessionId),
      session: result.session,
    };
  }

  async logout(auth: AuthenticatedUser): Promise<void> {
    await this.sessions.revokeSessionFamily(auth.sessionId);
  }

  /**
   * The caller's minimal identity, read fresh from the database. A token for a user that no longer
   * exists or is no longer active answers 401.
   */
  async me(auth: AuthenticatedUser): Promise<AuthMeResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId } });
    if (user?.status !== "ACTIVE") {
      throw authenticationFailed();
    }
    return { ...toAuthUser(user), status: user.status };
  }

  private async findOrCreateUser(phoneNumber: string, command: VerifyOtpCommand): Promise<User> {
    const existing = await this.prisma.user.findUnique({ where: { phoneNumber } });
    if (existing !== null) {
      return existing;
    }
    try {
      // role and status are never taken from the request: the column defaults apply (USER, ACTIVE).
      return await this.prisma.user.create({
        data: {
          phoneNumber,
          preferredLanguage: command.preferredLanguage ?? "EN",
          displayName: command.displayName ?? null,
        },
      });
    } catch (error) {
      // Created concurrently (another sign-in, or admin provisioning): use that account.
      if (isPrismaError(error, "P2002")) {
        return this.prisma.user.findUniqueOrThrow({ where: { phoneNumber } });
      }
      throw error;
    }
  }

  private async tokenResponse(user: User, sessionId: string): Promise<AuthTokenResponse> {
    const accessToken = await this.tokens.issue({
      userId: user.id,
      role: user.role,
      sessionId,
    });
    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: this.tokens.ttlSeconds,
      user: toAuthUser(user),
    };
  }

  private requireEnabled(): void {
    if (!this.enabled) {
      throw authenticationNotConfigured();
    }
  }

  private requireDelivery(): OtpDeliveryProvider {
    this.requireEnabled();
    if (this.delivery === null) {
      throw new ApiException(
        apiError(
          HttpStatus.SERVICE_UNAVAILABLE,
          "SERVICE_UNAVAILABLE",
          AUTH_ERROR_MESSAGES.otpDeliveryNotConfigured,
        ),
      );
    }
    return this.delivery;
  }
}

function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    preferredLanguage: user.preferredLanguage,
    timezone: user.timezone,
    role: user.role,
  };
}

function unauthorized(message: string): ApiException {
  return new ApiException(apiError(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", message));
}

/** Wrong, expired, used, superseded or exhausted code, or an unknown challenge: indistinguishable. */
const verificationFailed = (): ApiException => unauthorized(AUTH_ERROR_MESSAGES.invalidCode);
/** A correct code for an account that may not sign in (inactive, or gone). */
const authenticationFailed = (): ApiException =>
  unauthorized(AUTH_ERROR_MESSAGES.authenticationFailed);
const invalidRefreshToken = (): ApiException =>
  unauthorized(AUTH_ERROR_MESSAGES.invalidRefreshToken);
