/**
 * Identifies the rules used to produce a result. Increment it whenever a formula, rounding rule,
 * limit or output field changes meaning, so stored or explained results can be traced to the
 * rules that produced them.
 */
export const CALCULATION_VERSION = "1";

export type CalculationVersion = typeof CALCULATION_VERSION;
