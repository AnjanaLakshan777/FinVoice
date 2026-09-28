import type { CreateUserCommand, UpdateUserCommand, UserResponse } from "@finvoice/contracts";
import { Injectable } from "@nestjs/common";

import { ApiException } from "../common/api.exception.js";
import { omitUndefined } from "../common/omit-undefined.js";
import { isPrismaError } from "../common/prisma-errors.js";
import { PrismaService } from "../database/prisma.service.js";
import type { User } from "../generated/prisma/client.js";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(command: CreateUserCommand): Promise<UserResponse> {
    try {
      const user = await this.prisma.user.create({
        data: {
          phoneNumber: command.phoneNumber,
          preferredLanguage: command.preferredLanguage,
          displayName: command.displayName ?? null,
        },
      });
      return toUserResponse(user);
    } catch (error) {
      throw mapPhoneNumberConflict(error);
    }
  }

  async get(userId: string): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw userNotFound();
    }
    return toUserResponse(user);
  }

  /**
   * Self-service changes only: display name and language. The phone number (the login identity),
   * the role and the status are not changeable through the API.
   */
  async update(userId: string, command: UpdateUserCommand): Promise<UserResponse> {
    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: omitUndefined({
          preferredLanguage: command.preferredLanguage,
          displayName: command.displayName,
        }),
      });
      return toUserResponse(user);
    } catch (error) {
      if (isPrismaError(error, "P2025")) {
        throw userNotFound();
      }
      throw error;
    }
  }

  /** Throws 404 unless the user exists. Used by resources nested under a user. */
  async assertExists(userId: string): Promise<void> {
    const count = await this.prisma.user.count({ where: { id: userId } });
    if (count === 0) {
      throw userNotFound();
    }
  }
}

export function userNotFound(): ApiException {
  return ApiException.notFound("User not found");
}

function mapPhoneNumberConflict(error: unknown): unknown {
  // phone_number is the only unique column an (admin) client can set on users.
  if (isPrismaError(error, "P2002")) {
    return ApiException.conflict("A user with this phone number already exists", [
      { field: "phoneNumber", message: "Already registered to another user" },
    ]);
  }
  return error;
}

function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    phoneNumber: user.phoneNumber,
    displayName: user.displayName,
    preferredLanguage: user.preferredLanguage,
    timezone: user.timezone,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
