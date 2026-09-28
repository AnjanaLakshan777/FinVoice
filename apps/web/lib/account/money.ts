/**
 * Money in the web app is a decimal STRING end to end, exactly as the API sends and accepts it
 * ("150000.00"). These helpers only reformat strings for display and tidy what a person typed; they
 * never use floating-point numbers and never calculate anything. The API validates and decides.
 */

/**
 * Removes thousands separators and spaces people commonly type ("150,000" → "150000"). Anything
 * else is sent as typed: the API rejects invalid amounts with a clear message.
 */
export function normalizeAmountInput(value: string): string {
  return value.replace(/[\s,]/gu, "");
}

/** "150000.00" → "150,000.00". Returns the input unchanged if it is not a plain decimal. */
export function groupDigits(amount: string): string {
  const match = /^(-?)(\d+)(\.\d+)?$/u.exec(amount);
  if (match === null) {
    return amount;
  }
  const [, sign = "", whole = "", fraction = ""] = match;
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",")}${fraction}`;
}

/** "150000.00", "LKR" → "LKR 150,000.00". */
export function formatMoney(amount: string, currency: string): string {
  return `${currency} ${groupDigits(amount)}`;
}

/**
 * Whole cents of a decimal string with at most 2 decimals, as an integer (for a <progress>
 * element's value and max). Exact: BigInt arithmetic, no floating point. Null if not a decimal.
 * Amounts are at most 999,999,999,999.99, so the result is always a safe integer.
 */
export function toCents(amount: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(amount);
  if (match === null) {
    return null;
  }
  const [, whole = "0", fraction = ""] = match;
  return Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
}
