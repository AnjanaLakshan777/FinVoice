# @finvoice/finance-engine

Deterministic financial calculations with exact decimal arithmetic. Pure, synchronous TypeScript functions: no NestJS, Prisma, database, HTTP or network dependencies. The only dependency is [decimal.js](https://mikemcl.github.io/decimal.js/).

```ts
import { calculateLoanRepayment } from "@finvoice/finance-engine";

calculateLoanRepayment({ principal: "500000.00", annualInterestRate: "12.00", termMonths: 36 });
// → { calculationVersion: "1", monthlyPayment: "16607.15", finalPayment: "16607.33",
//     totalRepayment: "597857.58", totalInterest: "97857.58", assumptions: { … }, … }
```

| Function                 | Calculates                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `calculateLoanRepayment` | Regular and final payment, total repayment and interest of a reducing-balance loan |
| `calculateSavingsPlan`   | Regular and final monthly contribution to reach a target exactly                   |
| `calculateBudgetSummary` | Monthly surplus/deficit, expense ratio and savings rate                            |

- **Inputs:** money and percentages as decimal strings (`"500000.00"`, `"12.50"`), month counts as integers.
- **Outputs:** strings with exactly 2 decimal places, rounded half away from zero. Results are JSON-safe.
- **Instalments:** regular payments and contributions are whole cents, and the final one absorbs the rounding, so a series always adds up to its total exactly. A 0% loan repays exactly its principal.
- **Validation:** invalid input throws `FinanceValidationError` with the list of problems (`issues`). Values are never rounded or coerced, unknown fields such as a client-supplied `monthlyPayment` are rejected, and cross-field rules are enforced.
- **Shared rules:** `MONEY_PATTERN`, `isMoneyString`, `LOAN_LIMITS`, `SAVINGS_LIMITS` and `isValidAnnualInterestRate` are the single definition of these rules; `@finvoice/contracts` builds its API schemas from them.
- **Isolation:** decimal.js is configured with an isolated clone (50 significant digits, ROUND_HALF_UP), so global decimal.js settings are never changed.

Formulas, rounding policy and design rationale: [docs/architecture/financial-calculation-engine.md](../../docs/architecture/financial-calculation-engine.md).

The expected values in `test/` were computed independently of decimal.js (exact rational arithmetic with `BigInt`), so the tests check the formulas rather than repeat the implementation.
