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
