import type { IncomingMessage, ServerResponse } from "node:http";

import type { ApiConfig } from "@finvoice/config";
import {
  startGuestSessionRequestSchema,
  type AuthMeResponse,
  type AuthTokenResponse,
  type StartGuestSessionCommand,
} from "@finvoice/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";

import { ApiException, apiError } from "../common/api.exception.js";
import { API_CONFIG } from "../config/api-config.module.js";
import { CurrentUser, Public } from "./auth.decorators.js";
import { AuthService } from "./auth.service.js";
import type { AuthenticatedUser } from "./auth.types.js";
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
  type RefreshCookieSettings,
} from "./refresh-cookie.js";

/**
 * /api/v1/auth: guest sign-in, refresh-token rotation, logout (which deletes the guest account)
 * and identity.
 *
 * The refresh token only ever travels in the HttpOnly cookie (Path=/api/v1/auth), never in a JSON
 * body; the access token is returned in the body and sent back as `Authorization: Bearer`.
 */
@Controller("auth")
export class AuthController {
  private readonly cookie: RefreshCookieSettings;

  constructor(
    private readonly auth: AuthService,
    @Inject(API_CONFIG) config: ApiConfig,
  ) {
    this.cookie = config.auth.refreshCookie;
  }

  /**
   * Creates a guest account from a preferred language (and an optional name) and signs it in.
   * No phone number, code or password.
   *
   * JSON only (415 otherwise). An HTML form on another site could otherwise post here and replace
   * the visitor's refresh cookie with a new, empty account (login CSRF), cutting them off from
   * their own. A browser can send a JSON body cross-site only after a CORS preflight, which the
   * API never allows.
   */
  @Public()
  @Post("guest")
  @HttpCode(HttpStatus.CREATED)
  async guest(
    @Req() request: IncomingMessage,
    @Body({ schema: startGuestSessionRequestSchema }) body: StartGuestSessionCommand,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<AuthTokenResponse> {
    if (!/^application\/json(\s*;|$)/iu.test(request.headers["content-type"] ?? "")) {
      throw new ApiException(
        apiError(
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
          "UNSUPPORTED_MEDIA_TYPE",
          "Unsupported content type",
        ),
      );
    }
    const { body: tokens, session } = await this.auth.startGuestSession(body);
    setRefreshCookie(response, this.cookie, session.refreshToken, this.auth.refreshTokenTtlSeconds);
    return tokens;
  }

  /**
   * Public (the access token may have expired): the refresh cookie is the credential. On any
   * failure the cookie is cleared.
   */
  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<AuthTokenResponse> {
    try {
      const { body: tokens, session } = await this.auth.refresh(
        readRefreshCookie(request, this.cookie),
      );
      setRefreshCookie(
        response,
        this.cookie,
        session.refreshToken,
        this.auth.refreshTokenTtlSeconds,
      );
      return tokens;
    } catch (error) {
      clearRefreshCookie(response, this.cookie);
      throw error;
    }
  }

  /**
   * Ends the guest session and deletes the guest account with all of its data (an ADMIN account
   * only signs out), then clears the cookie.
   */
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<void> {
    await this.auth.logout(user);
    clearRefreshCookie(response, this.cookie);
  }

  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser): Promise<AuthMeResponse> {
    return this.auth.me(user);
  }
}
