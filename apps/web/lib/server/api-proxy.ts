import type { ApiErrorResponse } from "@finvoice/contracts";

import { rootEnvApiUrl } from "./root-env";

/**
 * SERVER-ONLY. The same-origin proxy from the web app to the FinVoice API's public routes.
 *
 * The browser only ever talks to the web origin: `https://<web>/api/v1/...` is forwarded here to
 * `<INTERNAL_API_URL>/api/v1/...`. That keeps the API's refresh cookie first-party to the web
 * origin: it stays HttpOnly and SameSite=Lax, and no CORS or cross-site cookie is needed. See
 * docs/architecture/web-authentication.md.
 *
 * The proxy is deliberately narrow:
 * - only `/api/v1/*` (never `/internal/*` or `/health`), and no `.`/`..` path segments;
 * - only the request headers the public API needs (never the internal service token, IP
 *   addresses or other browser headers); the Cookie header only for `/api/v1/auth/*`, the only
 *   path the refresh cookie is scoped to;
 * - only the response headers the browser needs, including every Set-Cookie;
 * - it logs nothing: bodies, tokens and cookies are passed through untouched.
 */

/** Used when INTERNAL_API_URL is not set: the local API. */
export const DEFAULT_API_URL = "http://127.0.0.1:4000";
export const API_PROXY_TIMEOUT_MS = 15_000;
/** The API accepts at most 100 kB; anything far larger is refused before forwarding. */
export const API_PROXY_MAX_BODY_BYTES = 1_048_576;

const FORWARDED_REQUEST_HEADERS = ["accept", "authorization", "content-type"] as const;
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "www-authenticate",
  "retry-after",
] as const;
const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

/**
 * SERVER-ONLY. The API base URL (INTERNAL_API_URL: the server's environment, then the root .env),
 * or null if it is not a valid http(s) URL. Not a secret, but never needed by the browser.
 */
export function apiBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.INTERNAL_API_URL ?? rootEnvApiUrl() ?? DEFAULT_API_URL;
  try {
    const url = new URL(configured);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href.replace(/\/+$/u, "")
      : null;
  } catch {
    return null;
  }
}

function errorResponse(status: number, body: ApiErrorResponse): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

const notFound = (): Response =>
  errorResponse(404, { statusCode: 404, code: "NOT_FOUND", message: "Route not found" });
const unavailable = (): Response =>
  errorResponse(503, {
    statusCode: 503,
    code: "SERVICE_UNAVAILABLE",
    message: "The FinVoice API is not available",
  });

/** True for a path segment that could escape /api/v1 or change the target's structure. */
function isUnsafeSegment(segment: string): boolean {
  return segment === "" || segment === "." || segment === ".." || /[/\\]/u.test(segment);
}

/** Forwards one browser request to the API and returns the API's answer. Never throws. */
export async function proxyApiRequest(
  request: Request,
  path: readonly string[],
  baseUrl: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (path.length === 0 || path.some(isUnsafeSegment)) {
    return notFound();
  }
  if (baseUrl === null) {
    return unavailable();
  }
  const { search } = new URL(request.url);
  const target = `${baseUrl}/api/v1/${path.map(encodeURIComponent).join("/")}${search}`;

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  const cookie = request.headers.get("cookie");
  if (path[0] === "auth" && cookie !== null) {
    headers.set("cookie", cookie);
  }

  let body: ArrayBuffer | undefined;
  if (!METHODS_WITHOUT_BODY.has(request.method)) {
    body = await request.arrayBuffer();
    if (body.byteLength > API_PROXY_MAX_BODY_BYTES) {
      return errorResponse(413, {
        statusCode: 413,
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body too large",
      });
    }
  }

  let upstream: Response;
  try {
    upstream = await fetchImpl(target, {
      method: request.method,
      headers,
      ...(body === undefined || body.byteLength === 0 ? {} : { body }),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(API_PROXY_TIMEOUT_MS),
    });
  } catch {
    // Unreachable API or timeout. No details: they could contain the internal URL.
    return unavailable();
  }

  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) {
      responseHeaders.set(name, value);
    }
  }
  for (const setCookie of upstream.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", setCookie);
  }
  const noBody = upstream.status === 204 || upstream.status === 304 || request.method === "HEAD";
  return new Response(noBody ? null : await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}
