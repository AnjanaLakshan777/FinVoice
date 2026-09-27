/**
 * Building blocks for deterministic rule patterns.
 *
 * Rules match the normalized analysis text (lower case, NFKC, collapsed whitespace; see
 * text/normalize.ts). Patterns are regular expressions assembled from reviewed word lists:
 * - `word()` for English and other Latin terms: the term must not be part of a longer word;
 * - `stem()` for Sinhala and Tamil: the term must start a word, but suffixes may follow (both
 *   languages attach case endings and particles to words, for example "OTP එක", "கடவுச்சொல்லை");
 * - `gap()` lets a request verb and its object be a few words apart, within one sentence.
 *
 * A pattern never runs a nested unbounded repetition, so matching stays linear in the content length.
 */
import type { IndicatorCode, IndicatorStrength } from "../indicators/catalog.js";
import { INVISIBLE_CHARACTERS } from "../text/normalize.js";

export type EvidenceType = "phrase" | "link";

/** A span of the normalized text that a rule matched. */
export type RuleMatch = {
  readonly start: number;
  readonly end: number;
  readonly evidenceType: EvidenceType;
  /** Overrides the indicator's default strength for this match. */
  readonly strength?: IndicatorStrength;
  /** What was found, for the explanation (for example "an OTP"). */
  readonly detail?: string;
};

export type DetectedMatches = ReadonlyMap<IndicatorCode, readonly RuleMatch[]>;

export type RuleLanguage = "EN" | "SI" | "TA";

export type Rule = {
  /** Stable identifier, for tests and review (never returned to users). */
  readonly id: string;
  readonly indicator: IndicatorCode;
  /** Languages whose wording the rule's patterns cover. */
  readonly languages: readonly RuleLanguage[];
  /** What the rule looks for, in plain words (for review and documentation). */
  readonly description: string;
  /**
   * Composite rules run after all pattern rules and may depend on their results (for example
   * IMPERSONATION only counts together with a suspicious request).
   */
  readonly composite: boolean;
  readonly find: (text: string, detected: DetectedMatches) => readonly RuleMatch[];
};

const LETTER_BEFORE = "(?<![\\p{L}\\p{M}\\p{N}_])";
const LETTER_AFTER = "(?![\\p{L}\\p{M}\\p{N}_])";

/** A whole Latin word or phrase. */
export function word(source: string): string {
  return `${LETTER_BEFORE}(?:${source})${LETTER_AFTER}`;
}

/** A Sinhala or Tamil word start (suffixes allowed). */
export function stem(source: string): string {
  return `${LETTER_BEFORE}(?:${source})`;
}

/**
 * An English verb inside a Sinhala or Tamil sentence, which takes a local helper verb: "send
 * කරන්න", "share කළා", "send பண்ணுங்க", "click செய்யவும்". A bare English verb after the object
 * ("OTP, send …") is English word order and is left to the English rules.
 */
export function mixedVerb(source: string): string {
  return `${word(source)} ${stem("කර|කළ|කෙරු|පණ්ණ|பண்ண|செய்")}`;
}

/** An alternation, as one group (safe to concatenate with other parts). */
export function anyOf(...sources: readonly string[]): string {
  return `(?:${sources.map((source) => `(?:${source})`).join("|")})`;
}

/** Abbreviations whose full stop does not end a sentence ("Rs. 5,000", "No. 12", "රු. 500"). */
const ABBREVIATION = "(?:rs|no|mr|mrs|ms|dr|ltd|pvt|acc|etc|vs|ref|approx|රු|ரூ)";
const SENTENCE_END = `(?:[!?;।]|(?<!(?<![\\p{L}\\p{M}])${ABBREVIATION})\\.)(?:\\s|$)`;

/**
 * Up to `max` characters inside one sentence: no line break, and no sentence-ending punctuation
 * followed by a space (so "bit.ly" and "Rs. 500" do not end a sentence). Lazy, so the nearest
 * following match wins.
 */
export function gap(max: number): string {
  return `(?:(?!${SENTENCE_END})[^\\n]){0,${String(max)}}?`;
}

/** The match extended by up to `count` following words of the same sentence (for evidence). */
export function extendByWords(text: string, match: RuleMatch, count: number): RuleMatch {
  const following = new RegExp(`^(?:[ ,](?!${SENTENCE_END})[^\\s.!?;,]+){0,${String(count)}}`, "u");
  const extension = following.exec(text.slice(match.end))?.[0] ?? "";
  return { ...match, end: match.end + extension.length };
}

/** Compiles a pattern; invisible characters (for example a Sinhala zero-width joiner) are removed. */
export function compile(source: string): RegExp {
  return new RegExp(source.replace(INVISIBLE_CHARACTERS, ""), "gu");
}

// ---------------------------------------------------------------------------------------------
// Negation and hypotheticals: "never share your OTP", "OTP එක දෙන්න එපා", "OTP ஐப் பகிர வேண்டாம்",
// "if anyone asks for your PIN" are warnings, not requests.
// ---------------------------------------------------------------------------------------------

const CLAUSE_BREAK = compile(
  `[.!?;:,\\n]|${word("but|unless|until|otherwise|or else|then|so|and then")}`,
);

const NEGATION_BEFORE = compile(
  anyOf(
    word(
      "never|not|don't|dont|do not|doesn't|does not|won't|will not|would not|wouldn't|shall not|cannot|can't|can not|shouldn't|should not|must not|mustn't|no one|no-one|nobody|no bank|no official|avoid|refuse|beware|be careful|careful (?:of|with|about)|watch out|be wary|stop",
    ),
    word(
      "if (?:any ?one|some ?one|somebody|anybody|a caller|a person|people|they|he|she|you are asked|you're asked|asked)",
    ),
    // Sinhala: never, not ever.
    stem("කිසිවිටෙක|කිසි විටෙක|කවදාවත්|කිසිදා|කිසිම විටක"),
    // Tamil: never.
    stem("ஒருபோதும்|ஒரு போதும்"),
  ),
);

const NEGATION_AFTER = compile(
  anyOf(
    // English: "share it with no one".
    word("(?:with|to) (?:no one|no-one|nobody)"),
    // Sinhala: don't, not, isn't.
    `${stem("එපා|නැහැ|නැත|නෑ|නොවේ")}${LETTER_AFTER}`,
    // Tamil: don't, must not, will not, is not.
    stem("வேண்டாம்|கூடாது|மாட்டோம்|மாட்டார்|மாட்டாது|இல்லை"),
    // Sinhala conditional ("if asked"): the next word ends in -හොත්.
    `${LETTER_BEFORE}[\\p{L}\\p{M}]*හොත්${LETTER_AFTER}`,
  ),
);

/** Tamil conditional verb ending ("கேட்டால்", if asked) on the matched verb itself. */
const TAMIL_CONDITIONAL = /[\p{L}\p{M}]*ால்$/u;
const WORD_TAIL = /^[\p{L}\p{M}]*/u;
const BEFORE_WINDOW = 60;
const AFTER_WINDOW = 30;

function lastClause(prefix: string): string {
  let from = 0;
  CLAUSE_BREAK.lastIndex = 0;
  for (let match = CLAUSE_BREAK.exec(prefix); match !== null; match = CLAUSE_BREAK.exec(prefix)) {
    from = match.index + match[0].length;
  }
  return prefix.slice(from);
}

function firstClause(suffix: string): string {
  CLAUSE_BREAK.lastIndex = 0;
  const match = CLAUSE_BREAK.exec(suffix);
  return match === null ? suffix : suffix.slice(0, match.index);
}

function test(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

/** True if the matched request is negated or hypothetical, so it is a warning, not a request. */
export function isNegated(text: string, start: number, end: number): boolean {
  const before = lastClause(text.slice(Math.max(0, start - BEFORE_WINDOW), start));
  // Also inside the match: "your OTP is …, do not share it" (object first, then a negated verb).
  if (test(NEGATION_BEFORE, before) || test(NEGATION_BEFORE, text.slice(start, end))) {
    return true;
  }
  const tail = WORD_TAIL.exec(text.slice(end))?.[0] ?? "";
  const matchedWord = text.slice(start, end) + tail;
  if (TAMIL_CONDITIONAL.test(matchedWord)) {
    return true;
  }
  const after = firstClause(text.slice(end, end + AFTER_WINDOW));
  return test(NEGATION_AFTER, after);
}

export type ScanOptions = {
  /** Skip negated or hypothetical matches (for requests). */
  readonly negatable?: boolean;
  readonly evidenceType?: EvidenceType;
  readonly strength?: IndicatorStrength;
  /** Describes a match for the explanation. */
  readonly detail?: (matched: string) => string | undefined;
};

/** All non-overlapping matches of `pattern` in `text`. */
export function scan(text: string, pattern: RegExp, options: ScanOptions = {}): RuleMatch[] {
  const matches: RuleMatch[] = [];
  pattern.lastIndex = 0;
  for (let found = pattern.exec(text); found !== null; found = pattern.exec(text)) {
    const start = found.index;
    const end = start + found[0].length;
    if (end === start) {
      pattern.lastIndex = start + 1;
      continue;
    }
    if (options.negatable === true && isNegated(text, start, end)) {
      // Retry from the next character: a later, non-negated request may overlap this one.
      pattern.lastIndex = start + 1;
      continue;
    }
    const detail = options.detail?.(found[0]);
    matches.push({
      start,
      end,
      evidenceType: options.evidenceType ?? "phrase",
      ...(options.strength === undefined ? {} : { strength: options.strength }),
      ...(detail === undefined ? {} : { detail }),
    });
  }
  return matches;
}

/** True if `pattern` occurs anywhere in `text`. */
export function occurs(text: string, pattern: RegExp): boolean {
  return test(pattern, text);
}

/** A rule made of one or more patterns scanned with the same options. */
export function patternRule(
  definition: Omit<Rule, "find" | "composite"> & {
    readonly patterns: readonly RegExp[];
    readonly options?: ScanOptions;
  },
): Rule {
  const { patterns, options, ...rest } = definition;
  return {
    ...rest,
    composite: false,
    find: (text) => patterns.flatMap((pattern) => scan(text, pattern, options)),
  };
}
