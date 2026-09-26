import { Decimal as GlobalDecimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import { isMoneyString, isPercentageString, isPositiveMoneyString } from "../src/index.js";
import { Decimal } from "../src/money/decimal.js";
import { formatMoney, formatPercentage } from "../src/money/money.js";

describe("money format", () => {
  it.each(["0", "0.00", "100", "100.00", "100.5", "100.50", "999999999999.99"])(
    "accepts %j",
    (value) => {
      expect(isMoneyString(value)).toBe(true);
    },
  );

  it.each([
    "100.123",
    "1.999",
    "-10.00",
    "1e5",
    "NaN",
    "Infinity",
    "abc",
    "",
    " 100",
    "100.",
    ".5",
    "007",
    "1000000000000",
    100,
    null,
  ])("rejects %j", (value) => {
    expect(isMoneyString(value)).toBe(false);
  });

  it("distinguishes positive amounts", () => {
    expect(isPositiveMoneyString("0.01")).toBe(true);
    expect(isPositiveMoneyString("0.00")).toBe(false);
  });
});

describe("percentage format", () => {
  it.each(["0", "12", "12.5", "12.50", "1000.00", "9999.99"])("accepts %j", (value) => {
    expect(isPercentageString(value)).toBe(true);
  });

  it.each(["-1", "12.345", "12%", "1e2", "10000", "NaN"])("rejects %j", (value) => {
    expect(isPercentageString(value)).toBe(false);
  });
});

describe("output formatting", () => {
  it.each([
    ["2.345", "2.35"],
    ["2.344", "2.34"],
    ["-2.345", "-2.35"],
    ["0.005", "0.01"],
    ["-0.004", "0.00"],
    ["100", "100.00"],
  ])("rounds %s half away from zero to %s", (input, expected) => {
    expect(formatMoney(new Decimal(input))).toBe(expected);
    expect(formatPercentage(new Decimal(input))).toBe(expected);
  });
});

describe("decimal configuration", () => {
  it("uses its own decimal.js settings without changing the global defaults", () => {
    expect(Decimal.precision).toBe(50);
    expect(Decimal.rounding).toBe(GlobalDecimal.ROUND_HALF_UP);
    expect(GlobalDecimal.precision).toBe(20);
    expect(GlobalDecimal.rounding).toBe(GlobalDecimal.ROUND_HALF_UP);
  });

  it("is exact where binary floating point is not", () => {
    expect(new Decimal("0.1").plus("0.2").toString()).toBe("0.3");
    expect(0.1 + 0.2).not.toBe(0.3);
  });
});
