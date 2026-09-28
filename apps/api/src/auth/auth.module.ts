import type { ApiConfig } from "@finvoice/config";
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { API_CONFIG } from "../config/api-config.module.js";
import { AccessTokenService } from "./access-token.service.js";
import { AuthController } from "./auth.controller.js";
import { AccessTokenGuard, RolesGuard } from "./auth.guards.js";
import { AuthService, OTP_DELIVERY } from "./auth.service.js";
import { OtpChallengeService } from "./otp-challenge.service.js";
import { createOtpDeliveryProvider, type OtpDeliveryProvider } from "./otp-delivery.js";
import { SessionService } from "./session.service.js";

/**
 * Authentication (Step 11): the /auth endpoints and the two global guards. Every route of the
 * application requires a valid access token unless marked @Public() or @InternalOnly(); @Roles()
 * restricts a route further. The guards run in registration order: authentication, then roles.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AccessTokenService,
    OtpChallengeService,
    SessionService,
    AuthService,
    {
      provide: OTP_DELIVERY,
      inject: [API_CONFIG],
      // Configuration validation already enforces the development/test-only rule; the factory
      // checks it again, independently.
      useFactory: (config: ApiConfig): OtpDeliveryProvider | null =>
        createOtpDeliveryProvider(config),
    },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AccessTokenService],
})
export class AuthModule {}
