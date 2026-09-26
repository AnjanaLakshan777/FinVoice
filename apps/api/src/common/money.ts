import { Prisma } from "../generated/prisma/client.js";

/**
 * Monetary values are exact decimals end to end: validated decimal strings in requests
 * (@finvoice/contracts), `Prisma.Decimal` (decimal.js) in services, NUMERIC(14,2) in PostgreSQL,
 * and decimal strings with exactly 2 decimal places in responses. JavaScript numbers are never
 * used for money.
 */
export function toMoney(value: string | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** Serialises a stored amount for API responses, e.g. "150000.00". */
export function toMoneyString(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

export function toNullableMoneyString(value: Prisma.Decimal | null): string | null {
  return value === null ? null : toMoneyString(value);
}
