import type {
  ApiErrorResponse,
  BudgetCalculationResponse,
  LoanCalculationResponse,
  SavingsCalculationResponse,
} from "@finvoice/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestApi, type TestApi } from "./api-app.js";

const LOAN_PATH = "/api/v1/calculations/loan";
const SAVINGS_PATH = "/api/v1/calculations/savings";
const BUDGET_PATH = "/api/v1/calculations/budget";

const LOAN_INPUT = { principal: "500000.00", annualInterestRate: "12.00", termMonths: 36 };
const SAVINGS_INPUT = { targetAmount: "300000.00", currentAmount: "50000.00", months: 12 };
const BUDGET_INPUT = { monthlyIncome: "150000.00", monthlyExpenses: "100000.00" };

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
});

function fieldsOf(body: unknown): (string | null)[] {
  return (body as ApiErrorResponse).details?.map((detail) => detail.field) ?? [];
}

async function rowCounts() {
  return Promise.all([
    api.prisma.user.count(),
    api.prisma.financialProfile.count(),
    api.prisma.financialGoal.count(),
  ]);
}

describe("POST /api/v1/calculations/loan", () => {
  it("returns the calculated repayment", async () => {
    const response = await api.request<LoanCalculationResponse>("POST", LOAN_PATH, LOAN_INPUT);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      calculationVersion: "1",
      principal: "500000.00",
      annualInterestRate: "12.00",
      termMonths: 36,
      monthlyPayment: "16607.15",
      finalPayment: "16607.33",
      totalRepayment: "597857.58",
      totalInterest: "97857.58",
      assumptions: {
        interestMethod: "reducing_balance",
        paymentFrequency: "monthly",
        monthlyRateMethod: "annual_rate_divided_by_12",
        feesIncluded: false,
        insuranceIncluded: false,
        earlyRepaymentIncluded: false,
      },
    });
  });

  it.each([
    ["monthlyPayment", "1234.56"],
    ["monthlyPayment", "999999.99"],
    ["totalInterest", "0.00"],
    ["totalRepayment", "1.00"],
    ["calculationVersion", "0"],
  ])("never accepts a client-supplied %s (%s)", async (field, value) => {
    const response = await api.request("POST", LOAN_PATH, { ...LOAN_INPUT, [field]: value });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(response.text).toContain(field);
  });

  it.each([
    [{ principal: "100.123" }, "principal"],
    [{ principal: 500000 }, "principal"],
    [{ principal: "1e5" }, "principal"],
    [{ principal: "NaN" }, "principal"],
    [{ principal: "0" }, "principal"],
    [{ principal: "-500000.00" }, "principal"],
    [{ annualInterestRate: "-1" }, "annualInterestRate"],
    [{ annualInterestRate: "1000.01" }, "annualInterestRate"],
    [{ annualInterestRate: 12 }, "annualInterestRate"],
    [{ termMonths: 0 }, "termMonths"],
    [{ termMonths: 601 }, "termMonths"],
    [{ termMonths: 36.5 }, "termMonths"],
    [{ termMonths: "36" }, "termMonths"],
  ])("rejects %j", async (override, field) => {
    const response = await api.request("POST", LOAN_PATH, { ...LOAN_INPUT, ...override });

    expect(response.status).toBe(400);
    expect(fieldsOf(response.body)).toEqual([field]);
  });

  it("uses the standard error format", async () => {
    const response = await api.request("POST", LOAN_PATH, { ...LOAN_INPUT, termMonths: 0 });

    expect(response.body).toEqual({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: [{ field: "termMonths", message: "Must be a whole number from 1 to 600" }],
    });
  });

  it("maps the engine's own validation (payment rounding to 0.00) to 400", async () => {
    const response = await api.request("POST", LOAN_PATH, {
      principal: "0.01",
      annualInterestRate: "0",
      termMonths: 600,
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: [
        {
          field: "principal",
          message: "Too small for this term: the monthly payment would round to 0.00",
        },
      ],
    });
  });

  it("repays exactly the principal on a 0% loan, with the final payment absorbing the cents", async () => {
    const response = await api.request<LoanCalculationResponse>("POST", LOAN_PATH, {
      principal: "100000",
      annualInterestRate: "0",
      termMonths: 12,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      monthlyPayment: "8333.33",
      finalPayment: "8333.37",
      totalRepayment: "100000.00",
      totalInterest: "0.00",
    });
  });

  it("rejects a client-supplied finalPayment", async () => {
    const response = await api.request("POST", LOAN_PATH, { ...LOAN_INPUT, finalPayment: "1.00" });

    expect(response.status).toBe(400);
    expect(response.text).toContain("finalPayment");
  });

  it("only accepts POST", async () => {
    expect((await api.request("GET", LOAN_PATH)).status).toBe(404);
  });
});

describe("POST /api/v1/calculations/savings", () => {
  it("returns the savings plan; the final contribution reaches the target exactly", async () => {
    const response = await api.request<SavingsCalculationResponse>(
      "POST",
      SAVINGS_PATH,
      SAVINGS_INPUT,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      calculationVersion: "1",
      targetAmount: "300000.00",
      currentAmount: "50000.00",
      remainingAmount: "250000.00",
      months: 12,
      requiredMonthlyContribution: "20833.33",
      finalContribution: "20833.37",
      plannedTotalContribution: "250000.00",
      differenceFromTarget: "0.00",
    });
  });

  it("rejects a current amount above the target (checked by the engine)", async () => {
    const response = await api.request("POST", SAVINGS_PATH, {
      targetAmount: "1000.00",
      currentAmount: "1000.01",
      months: 12,
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "VALIDATION_ERROR",
      details: [{ field: "currentAmount", message: "Must not exceed targetAmount" }],
    });
  });

  it.each([
    [{ requiredMonthlyContribution: "1.00" }, null],
    [{ targetAmount: "0" }, "targetAmount"],
    [{ currentAmount: "-1" }, "currentAmount"],
    [{ currentAmount: "1.999" }, "currentAmount"],
    [{ months: 0 }, "months"],
    [{ months: 12.5 }, "months"],
  ])("rejects %j", async (override, field) => {
    const response = await api.request("POST", SAVINGS_PATH, { ...SAVINGS_INPUT, ...override });

    expect(response.status).toBe(400);
    expect(fieldsOf(response.body)).toEqual([field]);
  });
});

describe("POST /api/v1/calculations/budget", () => {
  it("returns the budget summary", async () => {
    const response = await api.request<BudgetCalculationResponse>(
      "POST",
      BUDGET_PATH,
      BUDGET_INPUT,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      calculationVersion: "1",
      monthlyIncome: "150000.00",
      monthlyExpenses: "100000.00",
      monthlySurplus: "50000.00",
      expenseRatio: "66.67",
      savingsRate: "33.33",
      status: "SURPLUS",
    });
  });

  it("returns null ratios for zero income", async () => {
    const response = await api.request<BudgetCalculationResponse>("POST", BUDGET_PATH, {
      monthlyIncome: "0",
      monthlyExpenses: "5000",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      monthlySurplus: "-5000.00",
      expenseRatio: null,
      savingsRate: null,
      status: "DEFICIT",
    });
  });

  it.each(["monthlySurplus", "savingsRate", "expenseRatio", "status"])(
    "never accepts a client-supplied %s",
    async (field) => {
      const response = await api.request("POST", BUDGET_PATH, { ...BUDGET_INPUT, [field]: "1" });

      expect(response.status).toBe(400);
      expect(response.text).toContain(field);
    },
  );

  it.each([{ monthlyIncome: "-1" }, { monthlyExpenses: "-0.01" }, { monthlyIncome: 150000 }])(
    "rejects %j",
    async (override) => {
      const response = await api.request("POST", BUDGET_PATH, { ...BUDGET_INPUT, ...override });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
    },
  );
});

describe("calculation endpoints", () => {
  it("store nothing in the database", async () => {
    const before = await rowCounts();

    await api.request("POST", LOAN_PATH, LOAN_INPUT);
    await api.request("POST", SAVINGS_PATH, SAVINGS_INPUT);
    await api.request("POST", BUDGET_PATH, BUDGET_INPUT);

    expect(await rowCounts()).toEqual(before);
  });

  it("never expose engine internals in errors", async () => {
    const responses = await Promise.all([
      api.request("POST", LOAN_PATH, {
        principal: "0.01",
        annualInterestRate: "0",
        termMonths: 600,
      }),
      api.request("POST", SAVINGS_PATH, { targetAmount: "1", currentAmount: "2", months: 1 }),
      api.request("POST", BUDGET_PATH, { monthlyIncome: "x", monthlyExpenses: [] }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
      for (const internal of ["Decimal", "decimal.js", "FinanceValidationError", "    at "]) {
        expect(response.text).not.toContain(internal);
      }
    }
  });

  it("return identical results for identical requests", async () => {
    const first = await api.request("POST", LOAN_PATH, LOAN_INPUT);
    const second = await api.request("POST", LOAN_PATH, LOAN_INPUT);

    expect(second.text).toBe(first.text);
  });
});
