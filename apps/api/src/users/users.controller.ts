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

import { UsersService } from "./users.service.js";

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(
    @Body({ schema: createUserRequestSchema }) body: CreateUserCommand,
  ): Promise<UserResponse> {
    return this.users.create(body);
  }

  @Get(":userId")
  get(@Param({ schema: userParamsSchema }) params: UserParams): Promise<UserResponse> {
    return this.users.get(params.userId);
  }

  @Patch(":userId")
  update(
    @Param({ schema: userParamsSchema }) params: UserParams,
    @Body({ schema: updateUserRequestSchema }) body: UpdateUserCommand,
  ): Promise<UserResponse> {
    return this.users.update(params.userId, body);
  }
}
