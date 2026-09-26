import { Prisma } from "../generated/prisma/client.js";

/** True if `error` is a known Prisma request error with the given code (e.g. "P2002"). */
export function isPrismaError(
  error: unknown,
  code: string,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
