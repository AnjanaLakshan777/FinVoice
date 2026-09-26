/**
 * Independent reference implementation for tests: exact rational arithmetic on BigInt, sharing no
 * code with decimal.js or the engine. All amounts are integers in cents.
 *
 * The exact loan payment in cents is P·R·Aⁿ / (120000·(Aⁿ − Bⁿ)), with P the principal in cents,
 * R the annual rate in hundredths of a percent, A = 120000 + R and B = 120000.
 */

/** num/den rounded to the nearest integer, ties away from zero. */
function roundHalfUp(num: bigint, den: bigint): bigint {
  const negative = num < 0n !== den < 0n;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const q = (2n * n + d) / (2n * d);
  return negative ? -q : q;
}

export function toCents(amount: string): bigint {
  const [integer = "0", fraction = ""] = amount.split(".");
  return BigInt(integer) * 100n + BigInt(`${fraction}00`.slice(0, 2));
}

export function formatCents(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? "-" : ""}${String(abs / 100n)}.${String(abs % 100n).padStart(2, "0")}`;
}

/** The instalment split: regular rounded half-up (down if that leaves a final ≤ 0), final reconciles. */
function split(num: bigint, den: bigint, total: bigint, count: bigint) {
  if (count === 1n) {
    return { regular: total, final: total };
  }
  let regular = roundHalfUp(num, den);
  if (total - regular * (count - 1n) <= 0n) {
    regular = num / den; // amounts are non-negative: integer division rounds down
  }
  return { regular, final: total - regular * (count - 1n) };
}

export function referenceLoan(principal: string, annualInterestRate: string, termMonths: number) {
  const p = toCents(principal);
  const r = toCents(annualInterestRate);
  const n = BigInt(termMonths);
  let num: bigint;
  let den: bigint;
  if (r === 0n) {
    num = p;
    den = n;
  } else {
    const aN = (120000n + r) ** n;
    const bN = 120000n ** n;
    num = p * r * aN;
    den = 120000n * (aN - bN);
  }
  const total = roundHalfUp(num * n, den);
  const { regular, final } = split(num, den, total, n);
  return {
    monthlyPayment: formatCents(regular),
    finalPayment: formatCents(final),
    totalRepayment: formatCents(total),
    totalInterest: formatCents(total - p),
  };
}

export function referenceSavings(targetAmount: string, currentAmount: string, months: number) {
  const remaining = toCents(targetAmount) - toCents(currentAmount);
  const m = BigInt(months);
  const { regular, final } = split(remaining, m, remaining, m);
  return {
    remainingAmount: formatCents(remaining),
    requiredMonthlyContribution: formatCents(regular),
    finalContribution: formatCents(final),
    plannedTotalContribution: formatCents(regular * (m - 1n) + final),
  };
}

/** Deterministic pseudo-random generator (LCG), so generated cases are identical on every run. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
