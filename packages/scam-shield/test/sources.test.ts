import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ACTION_CODES,
  ACTION_KNOWLEDGE,
  ACTION_RELATED_KNOWLEDGE,
  INDICATOR_ACTIONS,
  INDICATOR_CODES,
  INDICATOR_DEFINITIONS,
  RULES,
  SCAM_SHIELD_SOURCE_SLUGS,
} from "../src/index.js";
import packageJson from "../package.json" with { type: "json" };

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

const SOURCES = sourceFiles(SRC).map((path) => ({ path, text: readFileSync(path, "utf8") }));

describe("governance: every rule is documented and source-backed", () => {
  it("every indicator has at least one knowledge source, an official basis, a review date and an explanation", () => {
    for (const code of INDICATOR_CODES) {
      const definition = INDICATOR_DEFINITIONS[code];
      expect(definition.code).toBe(code);
      expect(definition.sourceSlugs.length, code).toBeGreaterThan(0);
      for (const slug of definition.sourceSlugs) {
        expect(SCAM_SHIELD_SOURCE_SLUGS, code).toContain(slug);
      }
      expect(definition.officialBasis.length, code).toBeGreaterThan(20);
      expect(definition.reviewedOn, code).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(definition.explanation, code).not.toMatch(/\bis a scam|definitely|fraudulent\b/iu);
    }
  });

  it("every rule belongs to a catalogued indicator, has a unique id, a description and languages", () => {
    const ids = RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of RULES) {
      expect(INDICATOR_CODES, rule.id).toContain(rule.indicator);
      expect(rule.description.length, rule.id).toBeGreaterThan(20);
      expect(rule.languages.length, rule.id).toBeGreaterThan(0);
    }
    for (const code of INDICATOR_CODES) {
      expect(
        RULES.some((rule) => rule.indicator === code),
        code,
      ).toBe(true);
    }
  });

  it("every action maps to a knowledge article, and every indicator to at least one action", () => {
    for (const code of ACTION_CODES) {
      expect(SCAM_SHIELD_SOURCE_SLUGS).toContain(ACTION_KNOWLEDGE[code]);
    }
    for (const code of INDICATOR_CODES) {
      expect(INDICATOR_ACTIONS[code].length, code).toBeGreaterThan(0);
    }
    expect(ACTION_KNOWLEDGE.DO_NOT_SHARE_CREDENTIALS).toBe("protect-pin-otp-passwords");
    expect(ACTION_KNOWLEDGE.REPORT_SUSPICIOUS_ACTIVITY).toBe("report-suspicious-activity");
    expect(ACTION_KNOWLEDGE.CONTACT_BANK).toBe("report-suspicious-activity");
    // Related articles: known slugs, never the primary one again, no duplicates.
    for (const code of ACTION_CODES) {
      const related = ACTION_RELATED_KNOWLEDGE[code] ?? [];
      expect(new Set(related).size, code).toBe(related.length);
      expect(related, code).not.toContain(ACTION_KNOWLEDGE[code]);
      for (const slug of related) {
        expect(SCAM_SHIELD_SOURCE_SLUGS, code).toContain(slug);
      }
    }
    expect(ACTION_RELATED_KNOWLEDGE.REPORT_SUSPICIOUS_ACTIVITY).toEqual([
      "consumer-rights-and-complaints",
    ]);
  });

  it("does not detect remote-control apps (no verified source supports that rule)", () => {
    expect(
      RULES.some((rule) => /anydesk|teamviewer|remote[- ]control app/iu.test(rule.description)),
    ).toBe(false);
  });
});

describe("no contact details in engine code", () => {
  it("contains no hotline numbers, e-mail addresses, web addresses or postal addresses", () => {
    for (const { path, text } of SOURCES) {
      expect(text, path).not.toContain("1935");
      expect(text, path).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/iu);
      expect(text, path).not.toMatch(/https?:\/\/[a-z0-9]/iu);
      expect(text, path).not.toMatch(/www\.[a-z0-9]/iu);
      expect(text, path).not.toMatch(/cbsl\.gov\.lk|police\.lk|fiu\.gov\.lk/iu);
      expect(text, path).not.toMatch(/Janadhipathi Mawatha|Colombo \d/iu);
    }
  });
});

describe("framework independence", () => {
  it("imports only its own modules", () => {
    for (const { path, text } of SOURCES) {
      const imports = [...text.matchAll(/from\s+"([^"]+)"/gu)].map((match) => match[1] ?? "");
      for (const specifier of imports) {
        expect(
          specifier.startsWith("./") || specifier.startsWith("../"),
          `${path}: ${specifier}`,
        ).toBe(true);
      }
      expect(text, path).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|require\(/u);
    }
  });

  it("has no runtime dependencies", () => {
    expect("dependencies" in packageJson).toBe(false);
  });
});
