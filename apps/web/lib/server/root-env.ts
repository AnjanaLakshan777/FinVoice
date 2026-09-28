import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

let cachedApiUrl: string | null | undefined;

/**
 * SERVER-ONLY. INTERNAL_API_URL from the repository's root .env (like the API and the voice
 * gateway in development), read once at request time, never at build time. It is the ONLY value
 * the web proxy takes from that file: database, Gemini, auth and service-token secrets are never
 * read here. Not used in tests.
 */
export function rootEnvApiUrl(): string | null {
  if (process.env.NODE_ENV === "test") {
    return null;
  }
  if (cachedApiUrl === undefined) {
    const file = resolve(process.cwd(), "../../.env");
    cachedApiUrl = existsSync(file)
      ? (parseEnv(readFileSync(file, "utf8")).INTERNAL_API_URL ?? null)
      : null;
  }
  return cachedApiUrl;
}
