import type { IncomingMessage, ServerResponse } from "node:http";

import type { ApiConfig } from "@finvoice/config";
import {
  requestOtpRequestSchema,
  verifyOtpRequestSchema,
  type AuthMeResponse,
  type AuthTokenResponse,
  type RequestOtpRequest,
  type RequestOtpResponse,
  type VerifyOtpCommand,
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
 * /api/v1/auth: phone-OTP sign-in, refresh-token rotation, logout and identity.
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

  @Public()
  @Post("request-otp")
  @HttpCode(HttpStatus.ACCEPTED)
  requestOtp(
    @Body({ schema: requestOtpRequestSchema }) body: RequestOtpRequest,
  ): Promise<RequestOtpResponse> {
    return this.auth.requestOtp(body.phoneNumber);
  }

  @Public()
  @Post("verify-otp")
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body({ schema: verifyOtpRequestSchema }) body: VerifyOtpCommand,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<AuthTokenResponse> {
    const { body: tokens, session } = await this.auth.verifyOtp(body);
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

  /** Revokes the current sign-in (its whole token family) and clears the cookie. */
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
