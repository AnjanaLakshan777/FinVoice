import { z } from "zod";

/** A raw environment variable map, such as `process.env`. */
export type RawEnv = Readonly<Record<string, string | undefined>>;

/** Thrown when environment variables do not satisfy a service's configuration schema. */
export class ConfigValidationError extends Error {
  constructor(details: string) {
    super(`Invalid environment configuration:\n${details}`);
    this.name = "ConfigValidationError";
  }
}

/**
 * Validates raw environment variables against a schema.
 * Throws a {@link ConfigValidationError} listing every invalid variable, so a
 * misconfigured service fails fast at startup instead of at first use.
 */
export function parseEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  env: RawEnv,
): z.output<TSchema> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigValidationError(z.prettifyError(result.error));
  }
  return result.data;
}

export const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");

export type NodeEnv = z.output<typeof nodeEnvSchema>;

export const hostSchema = z.string().trim().min(1);

export const portSchema = z.coerce.number().int().min(1).max(65_535);

/**
 * A PostgreSQL connection URL. Validation errors never echo the value, because it
 * contains credentials.
 */
export const databaseUrlSchema = z.url({
  protocol: /^postgres(ql)?$/,
  error: (issue) =>
    issue.input === undefined ? "Required" : "Must be a postgresql:// connection URL",
});

/**
 * An optional secret. Empty or unset means "not configured" (null). Validation errors never echo
 * the value.
 */
export const optionalSecretSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === undefined || value === "" ? null : value));

/** Minimum length of the internal service token shared by the API and the voice gateway. */
export const INTERNAL_API_TOKEN_MIN_LENGTH = 32;

/** The internal service token: unset, or a long random string. */
export const internalApiTokenSchema = optionalSecretSchema.refine(
  (value) => value === null || value.length >= INTERNAL_API_TOKEN_MIN_LENGTH,
  { error: `Must be at least ${String(INTERNAL_API_TOKEN_MIN_LENGTH)} characters` },
);

/** A Gemini model name such as "gemini-3.8-flash". */
export const geminiModelSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9.-]{0,99}$/, {
    error: 'Must be a Gemini model name, e.g. "gemini-3.8-flash"',
  });
