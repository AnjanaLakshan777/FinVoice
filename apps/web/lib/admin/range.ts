import { ANALYTICS_TIMEZONE } from "@finvoice/contracts";

export const RANGE_PRESETS = ["7", "30", "90", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export type DashboardRange = { preset: RangePreset; from: string; to: string };

type SearchParams = Record<string, string | string[] | undefined>;

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Today's calendar date in the dashboard time zone (Asia/Colombo), "YYYY-MM-DD". */
export function todayInDashboardZone(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ANALYTICS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function daysBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The range selected in the query string: "Last 7/30/90 days" (ending today, in Asia/Colombo)
 * or a custom from/to. Only the date format is checked here; the API validates the range itself
 * (order, at most 366 days) and the page shows its rejection.
 */
export function parseDashboardRange(params: SearchParams, now: Date): DashboardRange {
  const preset = first(params.range);
  const today = todayInDashboardZone(now);
  if (preset === "custom") {
    const from = first(params.from);
    const to = first(params.to);
    if (from !== undefined && to !== undefined && DATE.test(from) && DATE.test(to)) {
      return { preset: "custom", from, to };
    }
  }
  const days = preset === "7" ? 7 : preset === "90" ? 90 : 30;
  return {
    preset: days === 7 ? "7" : days === 90 ? "90" : "30",
    from: daysBefore(today, days - 1),
    to: today,
  };
}
