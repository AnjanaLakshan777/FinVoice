# Financial calculation engine

> **Status:** Step 4. `packages/finance-engine` provides loan repayment, savings planning and budget summary calculations, exposed through `POST /api/v1/calculations/*` ([domain-api.md](../api/domain-api.md#calculations)).

## 1. Why the engine exists

FinVoice will explain money questions ("How much will a 500,000 rupee loan cost me per month?") in three languages, by voice and in the browser. The numbers in those answers must be **correct, identical everywhere and reproducible**. The engine is the single place where financial arithmetic happens:

- a small TypeScript library of **pure, synchronous functions**, with no NestJS, Prisma, database, HTTP or network dependencies;
- one function per calculation: `calculateLoanRepayment`, `calculateSavingsPlan`, `calculateBudgetSummary`;
- used by the API today, and usable unchanged by the web app or other services later.

## 2. Why AI does not do the maths

Language models are good at understanding a request and explaining a result. They are not reliable calculators: they can produce plausible but wrong numbers, and different runs can give different answers. For financial figures that is unacceptable. The split of responsibilities is therefore:

```text
Caller: "I need a 500,000 rupee loan at 12% for 3 years."
   ↓  AI understands the request and extracts structured inputs
{ "principal": "500000.00", "annualInterestRate": "12.00", "termMonths": 36 }
   ↓  POST /api/v1/calculations/loan: validated, calculated by the engine
{ "monthlyPayment": "16607.15", "finalPayment": "16607.33", "totalInterest": "97857.58", … }
   ↓  AI explains the authoritative result in the caller's language
"Your monthly payment would be about 16,607 rupees …"
```

- **The engine is authoritative.** The AI never computes, adjusts or "corrects" a figure. It only reads figures out of the engine's result.
- **Clients send inputs only.** A request containing a result field (`monthlyPayment`, `totalInterest`, `totalRepayment`, `savingsRate`, `monthlySurplus`, …) is rejected with 400 as an unknown property, both by the API contract and by the engine itself. Tests cover this for every calculator.
- **The engine validates independently.** It re-checks every input, including rules that span fields, and does not rely on the API layer to have done so.

## 3. Exact decimal arithmetic

JavaScript numbers are binary floating point: `0.1 + 0.2` is `0.30000000000000004`. Money is never calculated with them.

- The engine uses **[decimal.js](https://mikemcl.github.io/decimal.js/)** (exact decimal arithmetic, no dependencies), configured through an **isolated clone** (`Decimal.clone(...)`). It never changes the global decimal.js settings, so other code in the same process (for example Prisma's own decimal type) is unaffected.
- Configuration: **50 significant digits**, rounding **ROUND_HALF_UP** (ties away from zero), and no exponential notation.
- The engine does not use `Prisma.Decimal`, so it has no dependency on the database layer.
- Inputs and outputs are strings. Numbers appear only as whole-month counts (`termMonths`, `months`), which are exact integers.

## 4. Loan repayment: formula

A standard **reducing-balance (amortising)** loan with equal monthly payments:

```text
r   = annualInterestRate / 100 / 12                    (monthly rate)
EMI = P × r × (1 + r)^n / ((1 + r)^n − 1)             when r > 0
EMI = P / n                                            when r = 0
```

`P` is the principal and `n` the number of monthly payments. EMI is kept at full precision (50 significant digits). Payments are whole cents, so the result is:

```text
totalRepayment = EMI × n, rounded half-up to cents          (rounded once, from the exact EMI)
monthlyPayment = EMI rounded half-up to cents               (payments 1 … n − 1)
finalPayment   = totalRepayment − monthlyPayment × (n − 1)  (payment n)
totalInterest  = totalRepayment − P
```

The **final payment absorbs the cent rounding** of the regular payments (see [§8](#8-rounding-policy)). The payments therefore add up to `totalRepayment` exactly, and `totalInterest` is the exact interest rounded to cents. In particular, a **0% loan repays exactly the principal, with interest `0.00`**: 100,000 over 12 months is 11 payments of 8,333.33 and a final payment of 8,333.37.

Example: 500,000.00 at 12.00% for 36 months gives 35 payments of **16,607.15** and a final payment of **16,607.33**, a total repayment of 597,857.58 and total interest of 97,857.58. The test values were computed by an independent implementation (exact rational arithmetic with `BigInt`, `packages/finance-engine/test/reference.ts`). The engine is also checked against that implementation on 1,000 generated loans.

| Input                | Rule                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `principal`          | money string > 0                                                       |
| `annualInterestRate` | percentage string, 0 to 1000.00 (a technical bound, not a legal limit) |
| `termMonths`         | whole number, 1–600                                                    |

A principal so small that the regular payment would be 0.00 (for example 0.01 or 5.00 over 600 months) is rejected: payments of 0.00 are not a repayment plan.

## 5. Loan assumptions

Every result carries an `assumptions` object that states exactly what was modelled, and nothing more:

| Assumption               | Value                       | Meaning                                                   |
| ------------------------ | --------------------------- | --------------------------------------------------------- |
| `interestMethod`         | `reducing_balance`          | Interest is charged on the outstanding balance each month |
| `paymentFrequency`       | `monthly`                   | One equal payment per month                               |
| `monthlyRateMethod`      | `annual_rate_divided_by_12` | The monthly rate is the nominal annual rate / 12          |
| `feesIncluded`           | `false`                     | No processing, documentation or other fees                |
| `insuranceIncluded`      | `false`                     | No loan or credit insurance                               |
| `earlyRepaymentIncluded` | `false`                     | Every payment is made as scheduled; no prepayment         |

**This is an illustrative calculation, not a lender quote.** Real schedules can differ because lenders may round instalments differently, add fees, insurance or taxes, or use other compounding or day-count conventions. Explanations built on this result must say so.

## 6. Savings plan

The monthly contributions needed to reach a target from a current amount, in a number of months:

```text
remainingAmount             = targetAmount − currentAmount
requiredMonthlyContribution = remainingAmount / months, rounded half-up to cents    (months 1 … m − 1)
finalContribution           = remainingAmount − requiredMonthlyContribution × (months − 1)
plannedTotalContribution    = requiredMonthlyContribution × (months − 1) + finalContribution
differenceFromTarget        = remainingAmount − plannedTotalContribution
```

Rules: `targetAmount` > 0; `currentAmount` ≥ 0 and ≤ `targetAmount`; `months` a whole number from 1 to 600.

As with loans, the **final contribution absorbs the cent rounding**, so the plan always reaches the target exactly: `plannedTotalContribution` equals `remainingAmount` and `differenceFromTarget` is `"0.00"`. For example, 300,000 − 50,000 over 12 months is 11 contributions of 20,833.33 and a final one of 20,833.37. The field `differenceFromTarget` is kept so clients can check the plan reconciles. When the target is already reached, every amount is `0.00`. The target and current amount are never changed.

The plan is pure arithmetic. It has no interest or investment returns, no inflation and no recommendation.

## 7. Budget summary

```text
monthlySurplus = monthlyIncome − monthlyExpenses                 (negative = deficit)
expenseRatio   = monthlyExpenses / monthlyIncome × 100           (null if income is 0)
savingsRate    = monthlySurplus  / monthlyIncome × 100           (null if income is 0; negative for a deficit)
status         = SURPLUS if surplus > 0, BREAK_EVEN if 0, DEFICIT if < 0
```

With zero income, the ratios are `null` rather than dividing by zero. A negative savings rate is a mathematical result, not advice.

## 8. Rounding policy

1. **Inputs are never rounded.** A value with more than 2 decimal places (`"100.123"`) is rejected, not turned into `"100.12"`.
2. **Intermediate results keep 50 significant digits.** Totals are computed from the exact values and rounded once (`totalRepayment` = exact EMI × n; a savings plan totals exactly the remaining amount).
3. **Every monetary output and percentage is rounded once, half away from zero, to exactly 2 decimal places** (`2.345` → `2.35`, `−0.125` → `−0.13`). Negative zero is never output.
4. **Instalments are whole cents, and the final one reconciles.** A series of `n` payments or contributions is `n − 1` regular amounts (the exact amount rounded half-up to cents) plus a final amount = total − regular × (n − 1). The instalments therefore always add up to the total exactly. The final amount normally differs from the regular one by at most (n − 1) × 0.005: a few cents for typical terms, and at most about 3.00 at 600 months. Both amounts are returned (`monthlyPayment`/`finalPayment`, `requiredMonthlyContribution`/`finalContribution`), so the difference is visible, not hidden.
5. **The final amount is always positive.** If rounding the regular amount up would leave a final amount of zero or less (only for tiny amounts over many months, for example 29.95 over 600 months), the regular amount is rounded down instead: 599 × 0.04 plus a final 5.99. A loan whose regular payment would then be 0.00 is rejected.
6. **No negative interest from rounding.** Because the total is rounded once from the exact value, a 0% loan repays exactly its principal and total interest is never negative.

## 9. Input and output representations

| Kind               | Input                                                                                                        | Output                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Money              | string, up to 12 integer digits and 2 decimals, no sign, exponent or leading zeros: `"500000"`, `"500000.5"` | string with exactly 2 decimals: `"500000.50"` (can be negative for results such as a deficit) |
| Percentage (input) | string, up to 2 decimals: `"12"`, `"12.50"`                                                                  | string with exactly 2 decimals: `"12.00"`                                                     |
| Months             | JSON integer                                                                                                 | JSON integer                                                                                  |

JSON numbers are rejected for money and percentages. The money format is defined once, in the engine (`MONEY_PATTERN`), and `@finvoice/contracts` builds its API schemas from it. The same rule therefore applies to stored amounts (Step 3) and to calculation inputs.

## 10. Calculation version

Every result includes `"calculationVersion": "1"`. The version changes whenever a formula, rounding rule, limit or the meaning of an output field changes. Anyone who keeps or quotes a result can then tell which rules produced it. There is deliberately nothing more elaborate than this constant (`CALCULATION_VERSION`).

The final-instalment adjustment (§8) was made before version 1 was released, so the version is still `"1"`. Any change from now on increments it.

## 11. Why results are not stored

The calculations are stateless and cheap (well under a millisecond), and the same inputs always give the same output, so storing results adds nothing today. Storing them would also create personal financial data to protect and retain, with no feature that needs it yet. Persistence, together with `calculationVersion`, can be added when a feature needs history, for example "show me the loan I asked about last week".

## 12. How the future voice assistant will use it

When the voice assistant (Gemini Live) is added, each calculation will be exposed to the model as a **tool** whose parameters are exactly the request contract (`packages/contracts/src/calculations.ts`):

1. The model extracts inputs from the conversation and calls a tool such as `calculate_loan_repayment`.
2. The voice gateway runs the tool by calling `POST /api/v1/calculations/loan`. The model never runs the formula itself.
3. Invalid inputs come back as 400 errors with field-level messages, which the model can use to ask the caller for a correction.
4. The model explains the returned figures, including the assumptions and the "not a lender quote" caveat, without changing them.

## Code map

| Path                                                       | Contents                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/finance-engine/src/money/`                       | Isolated decimal configuration; money/percentage formats and rounding |
| `packages/finance-engine/src/input.ts`                     | Input validation that collects every issue and never coerces          |
| `packages/finance-engine/src/errors/`                      | `FinanceValidationError`                                              |
| `packages/finance-engine/src/loan/`, `savings/`, `budget/` | One calculator each                                                   |
| `packages/contracts/src/calculations.ts`                   | API request schemas and response types                                |
| `apps/api/src/calculations/`                               | Thin NestJS controller and service                                    |
