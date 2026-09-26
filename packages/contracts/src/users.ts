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

/** E.164: "+", a non-zero country-code digit, 8–15 digits in total. No spaces or punctuation. */
export const phoneNumberSchema = z
  .string({ error: "Must be a string" })
  .regex(/^\+[1-9][0-9]{7,14}$/, {
    error: 'Must be an E.164 phone number: "+" followed by 8 to 15 digits, e.g. "+94771234567"',
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

export const createUserRequestSchema = z.strictObject({
  phoneNumber: phoneNumberSchema,
  preferredLanguage: languageSchema,
  displayName: displayNameSchema.optional(),
});
export type CreateUserRequest = z.input<typeof createUserRequestSchema>;
export type CreateUserCommand = z.output<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z
  .strictObject({
    phoneNumber: phoneNumberSchema.optional(),
    preferredLanguage: languageSchema.optional(),
    displayName: displayNameSchema.optional(),
    status: userStatusSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    error: "At least one field must be provided",
  });
export type UpdateUserRequest = z.input<typeof updateUserRequestSchema>;
export type UpdateUserCommand = z.output<typeof updateUserRequestSchema>;

export type UserResponse = {
  id: string;
  phoneNumber: string;
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
