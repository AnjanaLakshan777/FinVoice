import { apiBaseUrl, proxyApiRequest } from "../../../../lib/server/api-proxy";

// Every request is forwarded at request time: nothing here may be cached or prerendered.
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

/**
 * Same-origin proxy to the FinVoice API's public routes (/api/v1/*). See lib/server/api-proxy.ts.
 */
async function forward(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxyApiRequest(request, path, apiBaseUrl());
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
