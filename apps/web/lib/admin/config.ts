import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

import { loadAdminDashboardConfig, type AdminDashboardConfig } from "@finvoice/config";

/** The only settings the dashboard may take from the repository's root .env. */
const ROOT_ENV_KEYS = [
  "ADMIN_DASHBOARD_ENABLED",
  "INTERNAL_API_URL",
  "INTERNAL_API_TOKEN",
] as const;

let rootEnvCache: Record<string, string> | undefined;

/**
 * The admin settings from the repository's root .env (like the API and the voice gateway), read
 * at request time on the server, never at build time, so the token cannot end up in build output
 * or build caches. Only ROOT_ENV_KEYS are taken. Not used in tests.
 */
function rootEnvSettings(): Record<string, string> {
  if (process.env.NODE_ENV === "test") {
    return {};
  }
  if (rootEnvCache === undefined) {
    const file = resolve(process.cwd(), "../../.env");
    const values = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
    rootEnvCache = Object.fromEntries(
      ROOT_ENV_KEYS.flatMap((key) => {
        const value = values[key];
        return value === undefined ? [] : [[key, value]];
      }),
    );
  }
  return rootEnvCache;
}

/**
 * SERVER-ONLY. The admin dashboard settings (ADMIN_DASHBOARD_ENABLED, INTERNAL_API_URL,
 * INTERNAL_API_TOKEN): the server's environment first, then the root .env. The result contains the
 * internal token: use it only in server code (server components, route handlers), and never pass
 * it to a client component, render, log or serialize it. None of these variables is NEXT_PUBLIC_*,
 * so Next.js never inlines them into browser JavaScript.
 *
 * Invalid settings disable the dashboard rather than failing open.
 */
export function adminDashboardConfig(env: NodeJS.ProcessEnv = process.env): AdminDashboardConfig {
  try {
    const fromEnv = Object.fromEntries(
      ROOT_ENV_KEYS.flatMap((key) => {
        const value = env[key];
        return value === undefined ? [] : [[key, value]];
      }),
    );
    return loadAdminDashboardConfig({ ...rootEnvSettings(), ...fromEnv });
  } catch {
    return { enabled: false, internalApi: { url: "", token: null } };
  }
}
