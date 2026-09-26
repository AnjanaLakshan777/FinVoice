import { Decimal as BaseDecimal } from "decimal.js";

/**
 * The engine's own decimal.js configuration, isolated with `clone()` so it never changes the
 * global `Decimal` settings used by other code in the same process.
 *
 * - `precision: 50` significant digits for intermediate results. Only final outputs are rounded.
 *   50 digits keep `(1 + r)^n - 1` accurate even for tiny rates over 600 months, where most
 *   leading digits cancel out.
 * - `rounding: ROUND_HALF_UP`: ties round away from zero (2.345 → 2.35, -2.345 → -2.35), the
 *   convention people expect when reading amounts.
 * - Exponent limits wide enough that decimal.js never switches to exponential notation.
 */
export const Decimal = BaseDecimal.clone({
  precision: 50,
  rounding: BaseDecimal.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100,
});

export type Decimal = InstanceType<typeof Decimal>;
