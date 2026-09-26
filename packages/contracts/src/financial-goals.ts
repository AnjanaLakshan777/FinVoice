import { z } from "zod";

import {
  calendarDateSchema,
  currencyCodeSchema,
  moneyAmountSchema,
  paginationQuerySchema,
  positiveMoneyAmountSchema,
  uuidSchema,
} from "./common.js";

export const FINANCIAL_GOAL_TYPES = [
  "SAVINGS",
  "EMERGENCY_FUND",
  "DEBT_REPAYMENT",
  "OTHER",
] as const;
export type FinancialGoalType = (typeof FINANCIAL_GOAL_TYPES)[number];
export const financialGoalTypeSchema = z.enum(FINANCIAL_GOAL_TYPES, {
  error: "Must be one of: SAVINGS, EMERGENCY_FUND, DEBT_REPAYMENT, OTHER",
});

export const FINANCIAL_GOAL_STATUSES = ["ACTIVE", "COMPLETED", "CANCELLED"] as const;
export type FinancialGoalStatus = (typeof FINANCIAL_GOAL_STATUSES)[number];
export const financialGoalStatusSchema = z.enum(FINANCIAL_GOAL_STATUSES, {
  error: "Must be one of: ACTIVE, COMPLETED, CANCELLED",
});

export const financialGoalNameSchema = z
  .string({ error: "Must be a string" })
  .trim()
  .min(1, { error: "Must not be empty" })
  .max(120, { error: "Must be at most 120 characters" });

export const financialGoalParamsSchema = z.strictObject({
  userId: uuidSchema,
  goalId: uuidSchema,
});
export type FinancialGoalParams = z.output<typeof financialGoalParamsSchema>;

/**
 * The rule currentAmount <= targetAmount spans fields and, on update, stored values, so the API
 * service enforces it (not this schema).
 */
export const createFinancialGoalRequestSchema = z.strictObject({
  type: financialGoalTypeSchema,
  name: financialGoalNameSchema,
  targetAmount: positiveMoneyAmountSchema,
  currentAmount: moneyAmountSchema.optional(),
  targetDate: calendarDateSchema.nullable().optional(),
  currency: currencyCodeSchema.optional(),
});
export type CreateFinancialGoalRequest = z.input<typeof createFinancialGoalRequestSchema>;
export type CreateFinancialGoalCommand = z.output<typeof createFinancialGoalRequestSchema>;

export const updateFinancialGoalRequestSchema = z
  .strictObject({
    type: financialGoalTypeSchema.optional(),
    name: financialGoalNameSchema.optional(),
    targetAmount: positiveMoneyAmountSchema.optional(),
    currentAmount: moneyAmountSchema.optional(),
    targetDate: calendarDateSchema.nullable().optional(),
    status: financialGoalStatusSchema.optional(),
    currency: currencyCodeSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    error: "At least one field must be provided",
  });
export type UpdateFinancialGoalRequest = z.input<typeof updateFinancialGoalRequestSchema>;
export type UpdateFinancialGoalCommand = z.output<typeof updateFinancialGoalRequestSchema>;

export const listFinancialGoalsQuerySchema = z.strictObject({
  ...paginationQuerySchema.shape,
  status: financialGoalStatusSchema.optional(),
  type: financialGoalTypeSchema.optional(),
});
export type ListFinancialGoalsQuery = z.output<typeof listFinancialGoalsQuerySchema>;

export type FinancialGoalResponse = {
  id: string;
  userId: string;
  type: FinancialGoalType;
  name: string;
  /** Decimal string with 2 decimal places. */
  targetAmount: string;
  /** Decimal string with 2 decimal places. */
  currentAmount: string;
  currency: string;
  /** Calendar date "YYYY-MM-DD", or null. */
  targetDate: string | null;
  status: FinancialGoalStatus;
  createdAt: string;
  updatedAt: string;
};
