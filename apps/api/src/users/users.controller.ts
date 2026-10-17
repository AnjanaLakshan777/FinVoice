import {
  updateUserRequestSchema,
  userParamsSchema,
  type UpdateUserCommand,
  type UserParams,
  type UserResponse,
} from "@finvoice/contracts";
import { Body, Controller, Get, Param, Patch } from "@nestjs/common";

import { OwnUserOnly } from "../auth/auth.decorators.js";
import { UsersService } from "./users.service.js";

/** A user's own account. Accounts are created only by POST /auth/guest. */
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(":userId")
  @OwnUserOnly()
  get(@Param({ schema: userParamsSchema }) params: UserParams): Promise<UserResponse> {
    return this.users.get(params.userId);
  }

  @Patch(":userId")
  @OwnUserOnly()
  update(
    @Param({ schema: userParamsSchema }) params: UserParams,
    @Body({ schema: updateUserRequestSchema }) body: UpdateUserCommand,
  ): Promise<UserResponse> {
    return this.users.update(params.userId, body);
  }
}
