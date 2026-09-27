import { INTERNAL_TOKEN_HEADER } from "@finvoice/contracts";
import type { AdminDashboardConfig } from "@finvoice/config";

import type { DashboardRange } from "./range";

/** The outcome of one analytics request. Failures carry a kind only, never error details. */
export type AnalyticsResult<T> =
  { ok: true; data: T } | { ok: false; reason: "invalid_range" | "unavailable" };

export const ANALYTICS_SECTIONS = [
  "overview",
  "trends",
  "languages",
  "knowledge",
  "scamshield",
  "literacy",
  "tools",
  "health",
  "knowledge-review",
] as const;
export type AnalyticsSection = (typeof ANALYTICS_SECTIONS)[number];

const TIMEOUT_MS = 5_000;

/**
 * SERVER-ONLY. Fetches one aggregate from the API's internal admin analytics endpoints, with the
 * internal token in a request header (the browser never sees it or calls these endpoints). Never
 * throws: any failure becomes `{ ok: false }`, so one failing section cannot break the page.
 */
export async function fetchAnalytics<T>(
  config: AdminDashboardConfig,
  section: AnalyticsSection,
  range: DashboardRange | null,
  fetchImpl: typeof fetch = fetch,
): Promise<AnalyticsResult<T>> {
  const { token, url } = config.internalApi;
  if (token === null || url === "") {
    return { ok: false, reason: "unavailable" };
  }
  const query =
    range === null ? "" : `?${new URLSearchParams({ from: range.from, to: range.to }).toString()}`;
  try {
    const response = await fetchImpl(`${url}/internal/admin/analytics/${section}${query}`, {
      headers: { [INTERNAL_TOKEN_HEADER]: token, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 400) {
      await response.body?.cancel();
      return { ok: false, reason: "invalid_range" };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
