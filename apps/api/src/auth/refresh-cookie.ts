import type { IncomingMessage, ServerResponse } from "node:http";

import { API_PREFIX } from "../app.setup.js";

/**
 * The refresh-token cookie, configured in one place: HttpOnly (never readable by browser
 * JavaScript), SameSite=Lax (not sent on cross-site POSTs), Path=/api/v1/auth (sent only to the
 * authentication endpoints), Secure in production (AUTH_REFRESH_COOKIE_SECURE).
 */
export const REFRESH_COOKIE_PATH = `/${API_PREFIX}/auth`;

export type RefreshCookieSettings = { name: string; secure: boolean };

function serialize(settings: RefreshCookieSettings, value: string, maxAgeSeconds: number): string {
  return [
    `${settings.name}=${value}`,
    `Max-Age=${String(maxAgeSeconds)}`,
    `Path=${REFRESH_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(settings.secure ? ["Secure"] : []),
  ].join("; ");
}

export function setRefreshCookie(
  response: ServerResponse,
  settings: RefreshCookieSettings,
  token: string,
  maxAgeSeconds: number,
): void {
  response.setHeader("Set-Cookie", serialize(settings, token, maxAgeSeconds));
  // Responses that set a credential must never be cached.
  response.setHeader("Cache-Control", "no-store");
}

export function clearRefreshCookie(
  response: ServerResponse,
  settings: RefreshCookieSettings,
): void {
  response.setHeader("Set-Cookie", serialize(settings, "", 0));
  response.setHeader("Cache-Control", "no-store");
}

/** The refresh token from the request's Cookie header, or null. */
export function readRefreshCookie(
  request: IncomingMessage,
  settings: RefreshCookieSettings,
): string | null {
  const header = request.headers.cookie;
  if (header === undefined) {
    return null;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === settings.name) {
      const value = part.slice(separator + 1).trim();
      return value === "" ? null : value;
    }
  }
  return null;
}
