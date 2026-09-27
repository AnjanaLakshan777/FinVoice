import {
  ANALYTICS_DEFAULT_RANGE_DAYS,
  ANALYTICS_MAX_RANGE_DAYS,
  ANALYTICS_TIMEZONE,
  daysBetween,
  type AnalyticsRange,
  type AnalyticsRangeQuery,
} from "@finvoice/contracts";

import { ApiException } from "../common/api.exception.js";

/** A requested range of calendar days, and the UTC instants that bound it ([start, end)). */
export type ResolvedRange = {
  range: AnalyticsRange;
  /** Midnight at the start of `from`, in ANALYTICS_TIMEZONE. */
  start: Date;
  /** Midnight after `to`, in ANALYTICS_TIMEZONE (exclusive). */
  end: Date;
  /** Every calendar day of the range, in order. */
  dates: string[];
};

const DAY_MS = 86_400_000;

/**
 * Resolves the dashboard date range. Days are calendar days in ANALYTICS_TIMEZONE (Asia/Colombo);
 * events are stored in UTC. Omitted dates default to the ANALYTICS_DEFAULT_RANGE_DAYS days ending
 * today. Every endpoint uses this function, so day boundaries are identical everywhere.
 */
export function resolveRange(query: AnalyticsRangeQuery, now: Date): ResolvedRange {
  const today = calendarDateIn(ANALYTICS_TIMEZONE, now);
  const to = query.to ?? (query.from === undefined ? today : maxDate(query.from, today));
  const from = query.from ?? addDays(to, -(ANALYTICS_DEFAULT_RANGE_DAYS - 1));
  const days = daysBetween(from, to) + 1;
  if (days < 1) {
    throw ApiException.validation([{ field: "from", message: "Must not be after to" }]);
  }
  if (days > ANALYTICS_MAX_RANGE_DAYS) {
    throw ApiException.validation([
      {
        field: "to",
        message: `The range must be at most ${String(ANALYTICS_MAX_RANGE_DAYS)} days`,
      },
    ]);
  }
  return {
    range: { from, to, timezone: ANALYTICS_TIMEZONE, days },
    start: zonedMidnight(from, ANALYTICS_TIMEZONE),
    end: zonedMidnight(addDays(to, 1), ANALYTICS_TIMEZONE),
    dates: Array.from({ length: days }, (_, index) => addDays(from, index)),
  };
}

/** The calendar date ("YYYY-MM-DD") of an instant in a time zone. */
export function calendarDateIn(timeZone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: string): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** The UTC instant of midnight at the start of `date` in `timeZone`. */
export function zonedMidnight(date: string, timeZone: string): Date {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  // Correct by the zone's offset; repeat once in case the offset differs at the corrected instant.
  let instant = utcMidnight - offsetMs(timeZone, utcMidnight);
  instant = utcMidnight - offsetMs(timeZone, instant);
  return new Date(instant);
}

/** The time zone's offset from UTC at an instant, in milliseconds. */
function offsetMs(timeZone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const value = (type: string): number =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}
