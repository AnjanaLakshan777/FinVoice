import { Decimal } from "./decimal.js";
import { roundToCents } from "./money.js";

export type Instalments = {
  /** Amount of each of the first `count − 1` instalments (for a single instalment, the total). */
  regular: Decimal;
  /** Amount of the last instalment. It absorbs the cent rounding of the regular instalments. */
  final: Decimal;
};

/**
 * Splits a total that is already in whole cents into `count` instalments: `count − 1` equal
 * regular instalments plus a final one, which together add up to the total exactly.
 *
 * - The regular instalment is the exact instalment rounded half-up to cents.
 * - The final instalment is `total − regular × (count − 1)`. It normally differs from the regular
 *   one by at most (count − 1) × 0.005, i.e. a few cents for typical terms.
 * - If rounding up would leave a final instalment of zero or less (only possible for tiny amounts
 *   spread over many instalments, e.g. 5.00 over 600), the regular instalment is rounded down
 *   instead, which leaves a positive final instalment whenever the total is positive.
 */
export function splitIntoInstalments(
  exactInstalment: Decimal,
  total: Decimal,
  count: number,
): Instalments {
  if (count === 1) {
    return { regular: total, final: total };
  }
  const regularCount = count - 1;
  let regular = roundToCents(exactInstalment);
  if (total.minus(regular.times(regularCount)).lessThanOrEqualTo(0)) {
    regular = exactInstalment.toDecimalPlaces(2, Decimal.ROUND_DOWN);
  }
  return { regular, final: total.minus(regular.times(regularCount)) };
}
