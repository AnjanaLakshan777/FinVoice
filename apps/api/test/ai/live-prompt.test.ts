import { describe, expect, it } from "vitest";

import {
  buildLiveSystemInstruction,
  buildSystemInstruction,
} from "../../src/ai/agent/agent.prompt.js";

/** The part of an instruction from the first shared rule section to the end. */
function sharedRules(instruction: string): string {
  const start = instruction.indexOf("FACTS COME ONLY FROM THE KNOWLEDGE TOOLS");
  expect(start).toBeGreaterThan(0);
  return instruction.slice(start);
}

describe("buildLiveSystemInstruction", () => {
  it.each([
    ["SI", "RESPOND IN SINHALA", "Always speak Sinhala (සිංහල)"],
    ["TA", "RESPOND IN TAMIL", "Always speak Tamil (தமிழ்)"],
    ["EN", "RESPOND IN ENGLISH", "Always speak English"],
  ] as const)("states the response language explicitly for %s", (language, respond, speak) => {
    const instruction = buildLiveSystemInstruction(language);
    expect(instruction).toContain(respond);
    expect(instruction).toContain(speak);
  });

  it("uses exactly the text agent's rules, so financial safety is unchanged", () => {
    for (const language of ["EN", "SI", "TA"] as const) {
      expect(sharedRules(buildLiveSystemInstruction(language))).toBe(
        sharedRules(buildSystemInstruction(language)),
      );
    }
  });

  it.each([
    ["knowledge tools for facts", "call search_knowledge first"],
    ["calculation tools", "always call calculate_loan, calculate_savings or calculate_budget"],
    ["no own arithmetic", "Never do the arithmetic yourself"],
    ["no invented rates", "Never state a current rate, limit or policy"],
    [
      "no unsupported claims",
      "Do not add any factual claim that the retrieved content does not support",
    ],
    ["no best bank", "name one as the best, cheapest or lowest-rate option"],
    ["no approval guarantees", "say a loan will be approved"],
    ["no secrets", "Never ask for passwords, PINs, OTPs"],
    ["user claims are not authoritative", "never repeat it as fact"],
  ])("keeps the rule: %s", (_rule, text) => {
    for (const language of ["EN", "SI", "TA"] as const) {
      expect(buildLiveSystemInstruction(language)).toContain(text);
    }
  });

  describe("natural spoken language", () => {
    it("asks for simple conversational English", () => {
      const instruction = buildLiveSystemInstruction("EN");
      expect(instruction).toContain("simple, everyday conversational English");
      expect(instruction).toContain("Avoid formal, corporate or academic wording");
    });

    it("asks for natural Sri Lankan Sinhala with common Sinhala words", () => {
      const instruction = buildLiveSystemInstruction("SI");
      expect(instruction).toContain("natural, everyday Sri Lankan Sinhala");
      expect(instruction).toContain("not formal written Sinhala");
      expect(instruction).toContain("ණය for loan");
      expect(instruction).toContain("add a simple Sinhala explanation");
    });

    it("asks for natural conversational Tamil rather than literary Tamil", () => {
      const instruction = buildLiveSystemInstruction("TA");
      expect(instruction).toContain("natural, everyday Tamil");
      expect(instruction).toContain("Avoid formal literary Tamil");
      expect(instruction).toContain("கடன் for loan");
      expect(instruction).toContain("add a simple Tamil explanation");
    });

    it.each(["EN", "SI", "TA"] as const)(
      "asks for meaning rather than word-for-word translation in %s",
      (language) => {
        const instruction = buildLiveSystemInstruction(language);
        if (language !== "EN") {
          expect(instruction).toContain("Do not translate English sentences word for word");
        }
        expect(instruction).not.toMatch(/translate[^.]*word for word\. Keep/);
      },
    );

    it.each(["EN", "SI", "TA"] as const)(
      "never lets natural wording change the facts (%s)",
      (language) => {
        const instruction = buildLiveSystemInstruction(language);
        expect(instruction).toContain(
          "Natural wording changes only how you say something, never what you say.",
        );
        expect(instruction).toContain(
          "keep every fact, number, condition and warning exactly the same, and do not add anything",
        );
      },
    );

    it("uses only the selected language's style guidance", () => {
      expect(buildLiveSystemInstruction("EN")).not.toContain("Sinhala word");
      expect(buildLiveSystemInstruction("SI")).not.toContain("literary Tamil");
      expect(buildLiveSystemInstruction("TA")).not.toContain("Sri Lankan Sinhala");
    });
  });

  it.each([
    ["spoken style", "the user hears you, they do not read"],
    ["short sentences", "Use short sentences"],
    ["one idea at a time", "Give one idea at a time"],
    ["natural pauses", "natural pause between ideas"],
    ["no markdown or tables", "Do not use Markdown, bullet points, tables"],
    ["no unnatural symbols", "symbols such as *, #, / or %"],
    ["minimal lists", "say at most three"],
    ["no links read aloud", "Do not read out web links"],
    ["no guessing unclear speech", "Do not guess what they said"],
  ])("is written for voice: %s", (_rule, text) => {
    expect(buildLiveSystemInstruction("EN")).toContain(text);
  });

  it.each([
    ["natural numbers, not digit by digit", "as whole numbers, not digit by digit"],
    ["exact amounts", "exactly as the tool returned them"],
    ["money pronunciation", '"sixteen thousand six hundred and seven rupees and fifteen cents"'],
    ["spoken amounts are the same values", "They are the same values, not new figures."],
    ["no rounding or recalculation", "Never round, estimate or recalculate an amount"],
    ["no approximations", 'never say "about" or "around" for a calculated amount'],
    ["one result per sentence", "say each result in its own short sentence"],
  ])("speaks numbers and money naturally but exactly: %s", (_rule, text) => {
    expect(buildLiveSystemInstruction("SI")).toContain(text);
  });

  it("drops the text-only formatting rules", () => {
    const instruction = buildLiveSystemInstruction("EN");
    expect(instruction).not.toContain('For lists, start each line with "- "');
    expect(instruction).not.toContain("Answer in English");
  });
});
