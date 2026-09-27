import { z } from "zod";

import {
  booleanFlagSchema,
  httpUrlSchema,
  internalApiTokenSchema,
  parseEnv,
  type RawEnv,
} from "./env.js";

const adminDashboardEnvSchema = z.object({
  /**
   * The temporary admin dashboard of the web app (/admin). Off unless explicitly "true": there is
   * no authentication yet, so it is for local development and trusted internal networks only.
   */
  ADMIN_DASHBOARD_ENABLED: booleanFlagSchema.default(false),
  /** Base URL of the API, for the web server's internal calls. Never exposed to browsers. */
  INTERNAL_API_URL: httpUrlSchema.default("http://127.0.0.1:4000"),
  /** Shared secret for the API's internal endpoints. Server-side only: never NEXT_PUBLIC_*. */
  INTERNAL_API_TOKEN: internalApiTokenSchema,
});

/**
 * Server-only settings of the web app's admin dashboard. Contains a credential
 * (`internalApi.token`): never pass this object to client components, log or serialize it.
 */
export type AdminDashboardConfig = {
  enabled: boolean;
  internalApi: {
    url: string;
    /** Null when INTERNAL_API_TOKEN is not set: the dashboard then shows data as unavailable. */
    token: string | null;
  };
};

export function loadAdminDashboardConfig(env: RawEnv = process.env): AdminDashboardConfig {
  const parsed = parseEnv(adminDashboardEnvSchema, env);
  return {
    enabled: parsed.ADMIN_DASHBOARD_ENABLED,
    internalApi: { url: parsed.INTERNAL_API_URL, token: parsed.INTERNAL_API_TOKEN },
  };
}
