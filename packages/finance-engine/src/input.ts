import {
  FinanceValidationError,
  type FinanceValidationIssue,
} from "./errors/finance-validation.error.js";
import { Decimal } from "./money/decimal.js";
import {
  isMoneyString,
  isPercentageString,
  MONEY_FORMAT_DESCRIPTION,
  PERCENTAGE_FORMAT_DESCRIPTION,
} from "./money/money.js";

/**
 * Reads and validates one calculation input. Every problem is collected, then `done()` throws a
 * single FinanceValidationError listing all of them. Values are never rounded or coerced: a value
 * that is not exactly valid is rejected.
 */
export class InputReader {
  private readonly issues: FinanceValidationIssue[] = [];
  private readonly values: Readonly<Record<string, unknown>>;

  constructor(input: unknown, allowedFields: readonly string[]) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      this.issues.push({ field: null, message: "Input must be an object" });
      this.values = {};
      return;
    }
    this.values = input as Record<string, unknown>;
    for (const field of Object.keys(this.values)) {
      if (!allowedFields.includes(field)) {
        this.issues.push({ field, message: "Unknown field" });
      }
    }
  }

  /** A money amount (`minimum` "zero" allows 0, "positive" requires > 0). */
  money(field: string, minimum: "zero" | "positive"): Decimal | undefined {
    const value = this.values[field];
    if (!isMoneyString(value)) {
      this.addIssue(field, `Must be ${MONEY_FORMAT_DESCRIPTION}`);
      return undefined;
    }
    const amount = new Decimal(value);
    if (minimum === "positive" && amount.isZero()) {
      this.addIssue(field, "Must be greater than 0");
      return undefined;
    }
    return amount;
  }

  /** A percentage between 0 and `max` (inclusive). */
  percentage(field: string, max: Decimal): Decimal | undefined {
    const value = this.values[field];
    if (!isPercentageString(value)) {
      this.addIssue(field, `Must be ${PERCENTAGE_FORMAT_DESCRIPTION}`);
      return undefined;
    }
    const percentage = new Decimal(value);
    if (percentage.greaterThan(max)) {
      this.addIssue(field, `Must be at most ${max.toFixed(2)}`);
      return undefined;
    }
    return percentage;
  }

  /** A whole number between `min` and `max` (inclusive). */
  integer(field: string, min: number, max: number): number | undefined {
    const value = this.values[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      this.addIssue(field, `Must be a whole number from ${String(min)} to ${String(max)}`);
      return undefined;
    }
    return value;
  }

  /** Records a rule that spans several fields. */
  addIssue(field: string | null, message: string): void {
    this.issues.push({ field, message });
  }

  /**
   * Throws if any issue was recorded; otherwise returns the values read. Every reader method
   * either returns a value or records an issue, so without issues no value is undefined.
   */
  finish<T extends Record<string, unknown>>(
    values: T,
  ): { [K in keyof T]: Exclude<T[K], undefined> } {
    if (this.issues.length > 0) {
      throw new FinanceValidationError(this.issues);
    }
    return values as { [K in keyof T]: Exclude<T[K], undefined> };
  }
}
