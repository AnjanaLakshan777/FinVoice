import { Decimal } from "./decimal.js";

/**
 * Money is exchanged as a decimal string: up to 12 integer digits, up to 2 decimal places, no
 * sign, no exponent, no leading zeros. This matches the database's NUMERIC(14,2) and is the single
 * definition of the format for the whole platform (@finvoice/contracts builds on it).
 *
 * Accepted: "0", "100", "100.5", "100.50", "999999999999.99".
 * Rejected: "100.123", "-10.00", "1e5", "NaN", "Infinity", "007", " 100", "100.".
 */
export const MONEY_PATTERN = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/;

export const MONEY_FORMAT_DESCRIPTION =
  'a non-negative decimal string with at most 2 decimal places and at most 12 integer digits, e.g. "1500.00"';

/**
 * A percentage such as an annual interest rate: up to 4 integer digits and 2 decimal places,
 * e.g. "12", "12.5", "12.50". The upper bound is set by each calculation.
 */
export const PERCENTAGE_PATTERN = /^(0|[1-9][0-9]{0,3})(\.[0-9]{1,2})?$/;

export const PERCENTAGE_FORMAT_DESCRIPTION =
  'a non-negative decimal string with at most 2 decimal places, e.g. "12.50"';

export function isMoneyString(value: unknown): value is string {
  return typeof value === "string" && MONEY_PATTERN.test(value);
}

/** A valid money string whose value is greater than zero. */
export function isPositiveMoneyString(value: unknown): value is string {
  return isMoneyString(value) && new Decimal(value).greaterThan(0);
}

export function isPercentageString(value: unknown): value is string {
  return typeof value === "string" && PERCENTAGE_PATTERN.test(value);
}

/** Rounds to 2 decimal places, half away from zero: the format of every monetary output. */
export function formatMoney(value: Decimal): string {
  return formatFixed2(value);
}

/** Percentages are also output with exactly 2 decimal places. */
export function formatPercentage(value: Decimal): string {
  return formatFixed2(value);
}

/** Rounds a value to whole cents (2 decimal places), half away from zero. */
export function roundToCents(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function formatFixed2(value: Decimal): string {
  const rounded = roundToCents(value);
  // A tiny negative value rounds to -0; never show "-0.00".
  return rounded.isZero() ? "0.00" : rounded.toFixed(2);
}
