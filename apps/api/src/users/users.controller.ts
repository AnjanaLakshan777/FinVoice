import {
  createUserRequestSchema,
  updateUserRequestSchema,
  userParamsSchema,
  type CreateUserCommand,
  type UpdateUserCommand,
  type UserParams,
  type UserResponse,
} from "@finvoice/contracts";
import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";

import { OwnUserOnly, Roles } from "../auth/auth.decorators.js";
import { UsersService } from "./users.service.js";

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * ADMIN-only provisioning (for example an account created on someone's behalf by support). Not a
   * registration endpoint: people sign up through phone-OTP verification. The new user always gets
   * role USER and status ACTIVE; no request can choose a role.
   */
  @Post()
  @Roles("ADMIN")
  create(
    @Body({ schema: createUserRequestSchema }) body: CreateUserCommand,
  ): Promise<UserResponse> {
    return this.users.create(body);
  }

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
