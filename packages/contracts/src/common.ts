import { z } from "zod";

/**
 * Monetary amounts travel as decimal strings, never JSON numbers, because binary floating
 * point cannot represent most decimal fractions exactly. The format matches the database's
 * NUMERIC(14,2): up to 12 integer digits, up to 2 decimal places, no sign, no exponent,
 * no leading zeros. Responses always use exactly 2 decimal places ("1500.00").
 */
const MONEY_PATTERN = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/;
const ZERO_PATTERN = /^0(\.0{1,2})?$/;
const MONEY_FORMAT_MESSAGE =
  'Must be a non-negative decimal string with at most 2 decimal places and at most 12 integer digits, e.g. "1500.00"';

/** A non-negative monetary amount, e.g. "0", "100.5", "150000.00". */
export const moneyAmountSchema = z
  .string({ error: 'Must be a decimal string, e.g. "1500.00" (JSON numbers are not accepted)' })
  .regex(MONEY_PATTERN, { error: MONEY_FORMAT_MESSAGE });

/** A monetary amount greater than zero. */
export const positiveMoneyAmountSchema = moneyAmountSchema.refine(
  (value) => !ZERO_PATTERN.test(value),
  {
    error: "Must be greater than 0",
  },
);

/** Currency used when a request omits one. Matches the database column default. */
export const DEFAULT_CURRENCY = "LKR";

/** An ISO 4217 currency code, e.g. "LKR". */
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, {
  error: 'Must be a 3-letter uppercase ISO 4217 currency code, e.g. "LKR"',
});

/**
 * A calendar date in ISO 8601 form ("YYYY-MM-DD"). It stays a string end to end, so it can never
 * shift to a neighbouring day through time-zone conversion. Impossible dates such as
 * "2027-02-30" are rejected, not rolled over.
 */
export const calendarDateSchema = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, {
    error: 'Must be a calendar date in the form "YYYY-MM-DD"',
  })
  .refine(isRealCalendarDate, { error: "Must be a real calendar date" });

function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export const uuidSchema = z.uuid({ error: "Must be a valid UUID" });

/** Bounded page-based pagination: `?page=1&limit=20`. */
export const paginationQuerySchema = z.object({
  page: z.coerce
    .number({ error: "Must be an integer >= 1" })
    .int({ error: "Must be an integer >= 1" })
    .min(1, { error: "Must be an integer >= 1" })
    .default(1),
  limit: z.coerce
    .number({ error: "Must be an integer between 1 and 100" })
    .int({ error: "Must be an integer between 1 and 100" })
    .min(1, { error: "Must be an integer between 1 and 100" })
    .max(100, { error: "Must be an integer between 1 and 100" })
    .default(20),
});

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type PaginatedResponse<T> = {
  data: T[];
  meta: PaginationMeta;
};

export const API_ERROR_CODES = [
  "VALIDATION_ERROR",
  "BAD_REQUEST",
  "NOT_FOUND",
  "CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "METHOD_NOT_ALLOWED",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export type ApiErrorDetail = {
  /** Dotted path of the offending field (e.g. "targetAmount"), or null for the request as a whole. */
  field: string | null;
  message: string;
};

/** Body of every error response from the domain API. */
export type ApiErrorResponse = {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  details?: ApiErrorDetail[];
};
