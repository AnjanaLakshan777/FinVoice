import {
  calculateBudgetToolInputSchema,
  calculateLoanToolInputSchema,
  calculateSavingsToolInputSchema,
} from "@finvoice/contracts";
import {
  calculateBudgetSummary,
  calculateLoanRepayment,
  calculateSavingsPlan,
  LOAN_LIMITS,
  SAVINGS_LIMITS,
} from "@finvoice/finance-engine";

import { defineTool, type AgentTool } from "./agent-tool.js";

const MONEY_HINT =
  'A decimal string with at most 2 decimal places and no commas, spaces or currency symbols, e.g. "500000.00" for Rs. 500,000.';

/**
 * Calculation tools: thin wrappers around @finvoice/finance-engine. They contain no formulas and
 * return the engine's result unchanged (exact decimal strings), so every figure the agent states
 * comes from the engine. Inputs are the calculation API's contracts: a result such as
 * `monthlyPayment` can never be supplied as an input.
 */
export function createCalculationTools(): AgentTool[] {
  return [
    defineTool({
      name: "calculate_loan",
      description:
        "Calculate the repayment of a standard reducing-balance loan with monthly payments: regular and final monthly payment, total repayment and total interest. Always use this for loan questions; never calculate yourself. Only call it when the user has given the amount, the annual interest rate and the term.",
      parameters: {
        type: "object",
        properties: {
          principal: { type: "string", description: `Amount borrowed. ${MONEY_HINT}` },
          annualInterestRate: {
            type: "string",
            description: `Annual interest rate in percent, 0 to ${LOAN_LIMITS.maxAnnualInterestRate}, as a decimal string, e.g. "12.00" for 12%.`,
          },
          termMonths: {
            type: "integer",
            minimum: LOAN_LIMITS.minTermMonths,
            maximum: LOAN_LIMITS.maxTermMonths,
            description: "Number of monthly payments, e.g. 36 for 3 years.",
          },
        },
        required: ["principal", "annualInterestRate", "termMonths"],
      },
      input: calculateLoanToolInputSchema,
      run: (input) => calculateLoanRepayment(input),
    }),

    defineTool({
      name: "calculate_savings",
      description:
        "Calculate the monthly contributions needed to reach a savings target from a current amount in a number of months (no interest or returns). Always use this for savings-plan questions; never calculate yourself.",
      parameters: {
        type: "object",
        properties: {
          targetAmount: { type: "string", description: `Savings target. ${MONEY_HINT}` },
          currentAmount: {
            type: "string",
            description: `Amount already saved, not more than the target ("0" if nothing yet). ${MONEY_HINT}`,
          },
          months: {
            type: "integer",
            minimum: SAVINGS_LIMITS.minMonths,
            maximum: SAVINGS_LIMITS.maxMonths,
            description: "Number of months to reach the target.",
          },
        },
        required: ["targetAmount", "currentAmount", "months"],
      },
      input: calculateSavingsToolInputSchema,
      run: (input) => calculateSavingsPlan(input),
    }),

    defineTool({
      name: "calculate_budget",
      description:
        "Calculate a monthly budget summary from income and expenses: surplus or deficit, expense ratio and savings rate. Always use this for budget questions; never calculate yourself.",
      parameters: {
        type: "object",
        properties: {
          monthlyIncome: { type: "string", description: `Monthly income. ${MONEY_HINT}` },
          monthlyExpenses: { type: "string", description: `Monthly expenses. ${MONEY_HINT}` },
        },
        required: ["monthlyIncome", "monthlyExpenses"],
      },
      input: calculateBudgetToolInputSchema,
      run: (input) => calculateBudgetSummary(input),
    }),
  ];
}
