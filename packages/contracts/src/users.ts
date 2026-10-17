import { z } from "zod";

import { uuidSchema } from "./common.js";

export const LANGUAGES = ["SI", "TA", "EN"] as const;
export type Language = (typeof LANGUAGES)[number];
export const languageSchema = z.enum(LANGUAGES, { error: "Must be one of: SI, TA, EN" });

export const USER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const userStatusSchema = z.enum(USER_STATUSES, {
  error: "Must be one of: ACTIVE, INACTIVE",
});

/**
 * Optional display name, trimmed. Empty or whitespace-only input means "no display name" and is
 * stored as null, both on create and on update.
 */
export const displayNameSchema = z
  .string({ error: "Must be a string or null" })
  .trim()
  .max(100, { error: "Must be at most 100 characters" })
  .transform((value) => (value === "" ? null : value))
  .nullable();

export const userParamsSchema = z.strictObject({ userId: uuidSchema });
export type UserParams = z.output<typeof userParamsSchema>;

/**
 * What a signed-in user may change about themselves (PATCH /me, PATCH /users/:userId for their own
 * id). The role and status are administrative: never user-editable. Those fields are rejected.
 * Accounts are created only by starting a guest session (POST /auth/guest).
 */
export const updateUserRequestSchema = z
  .strictObject({
    preferredLanguage: languageSchema.optional(),
    displayName: displayNameSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    error: "At least one field must be provided",
  });
export type UpdateUserRequest = z.input<typeof updateUserRequestSchema>;
export type UpdateUserCommand = z.output<typeof updateUserRequestSchema>;

export type UserResponse = {
  id: string;
  displayName: string | null;
  preferredLanguage: Language;
  /** IANA time zone name. Read-only for now. */
  timezone: string;
  status: UserStatus;
  /** ISO 8601 timestamp (UTC). */
  createdAt: string;
  /** ISO 8601 timestamp (UTC). */
  updatedAt: string;
};
