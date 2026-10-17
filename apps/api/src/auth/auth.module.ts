import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { AccessTokenService } from "./access-token.service.js";
import { AuthController } from "./auth.controller.js";
import { AccessTokenGuard, RolesGuard } from "./auth.guards.js";
import { AuthService } from "./auth.service.js";
import { SessionService } from "./session.service.js";

/**
 * Authentication: guest sign-in, the /auth endpoints and the two global guards. Every route of the
 * application requires a valid access token unless marked @Public() or @InternalOnly(); @Roles()
 * restricts a route further. The guards run in registration order: authentication, then roles.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AccessTokenService,
    SessionService,
    AuthService,
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AccessTokenService],
})
export class AuthModule {}
