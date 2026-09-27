import { NextResponse } from "next/server";

import { adminDashboardConfig } from "./lib/admin/config";

/**
 * Returns a real 404 for the admin dashboard while it is disabled (the default), before anything
 * is rendered: the page itself also calls notFound(), but the app's loading boundary starts
 * streaming a 200 response before a page can change the status. No admin data and no API call.
 */
export function proxy(): NextResponse {
  if (!adminDashboardConfig().enabled) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
