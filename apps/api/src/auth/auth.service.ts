import type { ApiConfig } from "@finvoice/config";
import {
  AUTH_ERROR_MESSAGES,
  type AuthMeResponse,
  type AuthTokenResponse,
  type AuthUser,
  type StartGuestSessionCommand,
} from "@finvoice/contracts";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";

import { ApiException, apiError } from "../common/api.exception.js";
import { API_CONFIG } from "../config/api-config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import type { User } from "../generated/prisma/client.js";
import { AccessTokenService } from "./access-token.service.js";
import { authenticationNotConfigured } from "./auth.guards.js";
import type { AuthenticatedUser } from "./auth.types.js";
import { SessionService, type IssuedSession } from "./session.service.js";

/** A completed sign-in or refresh: the JSON body, and the refresh token for the cookie. */
export type SignInResult = { body: AuthTokenResponse; session: IssuedSession };

/**
 * Guest sign-in, refresh, logout and identity. See docs/architecture/authentication-authorization.md.
 *
 * There are no phone numbers, codes or passwords: a guest session creates a new account from a
 * preferred language and signs it in. The account is reachable only through the refresh cookie of
 * that browser, so logging out deletes it with all of its data. Nothing here logs or returns a
 * token or a secret.
 */
@Injectable()
export class AuthService {
  private readonly enabled: boolean;
  private readonly guestLimit: number;
  private readonly guestWindowMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly tokens: AccessTokenService,
    @Inject(API_CONFIG) config: ApiConfig,
  ) {
    this.enabled = config.auth.enabled;
    this.guestLimit = config.auth.guest.limit;
    this.guestWindowMs = config.auth.guest.windowSeconds * 1000;
  }

  get refreshTokenTtlSeconds(): number {
    return this.sessions.ttlSeconds;
  }

  /**
   * Creates a guest account (role USER, status ACTIVE: never taken from the request) and signs it
   * in.
   *
   * Rate limit: at most AUTH_GUEST_SESSION_LIMIT accounts per AUTH_GUEST_SESSION_WINDOW_SECONDS,
   * for all clients together, counted from the users table (no IP addresses are stored). A
   * transaction-scoped advisory lock serialises concurrent requests, so they cannot all pass the
   * count at once. Throws 429 when exceeded.
   */
  async startGuestSession(
    command: StartGuestSessionCommand,
    now: Date = new Date(),
  ): Promise<SignInResult> {
    this.requireEnabled();
    const windowStart = new Date(now.getTime() - this.guestWindowMs);
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"auth-guest-create"}, 0))`;
      const recent = await tx.user.count({ where: { createdAt: { gt: windowStart } } });
      if (recent >= this.guestLimit) {
        throw new ApiException(
          apiError(
            HttpStatus.TOO_MANY_REQUESTS,
            "TOO_MANY_REQUESTS",
            AUTH_ERROR_MESSAGES.tooManyGuestSessions,
          ),
        );
      }
      return tx.user.create({
        data: {
          preferredLanguage: command.preferredLanguage,
          displayName: command.displayName ?? null,
          createdAt: now,
        },
      });
    });
    const session = await this.sessions.start(user.id, now);
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

  /**
   * Ends the guest account: deletes the user, which removes its sessions, financial profile,
   * goals and literacy data with it (ON DELETE CASCADE). There is no way to sign in to a guest
   * account again, so nothing is kept. Access tokens already issued stop working at /auth/me and
   * find no data; they expire within AUTH_ACCESS_TOKEN_TTL_SECONDS.
   */
  async logout(auth: AuthenticatedUser): Promise<void> {
    await this.prisma.user.deleteMany({ where: { id: auth.userId, role: "USER" } });
    // An ADMIN account is never deleted by logout: only its sign-in ends.
    await this.sessions.revokeSessionFamily(auth.sessionId);
  }

  /**
   * The caller's minimal identity, read fresh from the database. A token for a user that no longer
   * exists or is no longer active answers 401.
   */
  async me(auth: AuthenticatedUser): Promise<AuthMeResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId } });
    if (user?.status !== "ACTIVE") {
      throw unauthorized(AUTH_ERROR_MESSAGES.authenticationFailed);
    }
    return { ...toAuthUser(user), status: user.status };
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

const invalidRefreshToken = (): ApiException =>
  unauthorized(AUTH_ERROR_MESSAGES.invalidRefreshToken);
