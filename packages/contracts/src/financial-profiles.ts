import { z } from "zod";

import { currencyCodeSchema, moneyAmountSchema } from "./common.js";

/**
 * Full replacement of a user's financial profile. Omitted or null amounts mean "not provided yet"
 * and are stored as null; an omitted currency means LKR.
 */
export const putFinancialProfileRequestSchema = z.strictObject({
  monthlyIncome: moneyAmountSchema.nullable().optional(),
  monthlyExpenses: moneyAmountSchema.nullable().optional(),
  currency: currencyCodeSchema.optional(),
});
export type PutFinancialProfileRequest = z.input<typeof putFinancialProfileRequestSchema>;
export type PutFinancialProfileCommand = z.output<typeof putFinancialProfileRequestSchema>;

export type FinancialProfileResponse = {
  userId: string;
  /** Decimal string with 2 decimal places, or null if not provided yet. */
  monthlyIncome: string | null;
  /** Decimal string with 2 decimal places, or null if not provided yet. */
  monthlyExpenses: string | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
};
