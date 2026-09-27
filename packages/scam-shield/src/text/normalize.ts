/**
 * Analysis text: a normalized copy of the content for matching, with a map back to the original.
 *
 * The original content is never modified; evidence is always cut from the original through the map.
 * Normalization (per grapheme cluster, so Sinhala and Tamil letters and their vowel signs stay
 * together):
 * - Unicode NFKC (compatibility forms, full-width letters and digits, composed vowel signs);
 * - lower case (case folding for Latin text; Sinhala and Tamil have no case);
 * - invisible formatting characters removed (zero-width joiner and non-joiner, zero-width space,
 *   word joiner, byte-order mark, soft hyphen): in Sinhala the zero-width joiner only selects a
 *   conjunct glyph (for example in "ශ්‍රී"), so matching ignores it and patterns are written without it;
 * - typographic quotes and dashes mapped to their ASCII forms;
 * - whitespace runs collapsed to one space, or to one line break if the run contains one.
 * No letters of any script are removed or transliterated.
 */

export type AnalysisText = {
  /** The trimmed content, exactly as submitted. */
  readonly original: string;
  /** The normalized text that rules match against. */
  readonly text: string;
  /** For each UTF-16 unit of `text`, the start offset of its source in `original`. */
  readonly starts: readonly number[];
  /** For each UTF-16 unit of `text`, the end offset (exclusive) of its source in `original`. */
  readonly ends: readonly number[];
};

/** Zero-width and other invisible formatting characters (see above). */
export const INVISIBLE_CHARACTERS = /[\u00AD\u200B-\u200D\u2060\uFEFF]/gu;

const PUNCTUATION: Readonly<Record<string, string>> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "′": "'",
  "`": "'",
  "´": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "″": '"',
  "«": '"',
  "»": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
};

const WHITESPACE = /^\s+$/u;
/** Line feed, carriage return, vertical tab, form feed, line/paragraph separators, next line. */
const LINE_BREAK = /[\n\r\v\f\p{Zl}\p{Zp}\x85]/u;
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

function normalizeCluster(cluster: string): string {
  const visible = cluster.replace(INVISIBLE_CHARACTERS, "");
  if (visible === "") {
    return "";
  }
  const folded = visible.normalize("NFKC").toLowerCase();
  return PUNCTUATION[folded] ?? folded;
}

export function toAnalysisText(original: string): AnalysisText {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  const push = (value: string, start: number, end: number): void => {
    text += value;
    // One map entry per UTF-16 unit of the normalized value.
    starts.push(...Array.from({ length: value.length }, () => start));
    ends.push(...Array.from({ length: value.length }, () => end));
  };

  for (const { segment, index } of segmenter.segment(original)) {
    const end = index + segment.length;
    if (WHITESPACE.test(segment)) {
      const separator = LINE_BREAK.test(segment) ? "\n" : " ";
      const last = text.at(-1);
      if (last === undefined) {
        continue;
      }
      if (last === " " || last === "\n") {
        // Extend the previous separator; a line break wins over a space.
        if (separator === "\n" && last === " ") {
          text = `${text.slice(0, -1)}\n`;
        }
        ends[ends.length - 1] = end;
        continue;
      }
      push(separator, index, end);
      continue;
    }
    push(normalizeCluster(segment), index, end);
  }
  return { original, text, starts, ends };
}

/** Maps a span of the normalized text back to the span of the original content it came from. */
export function toOriginalSpan(
  analysis: AnalysisText,
  start: number,
  end: number,
): { start: number; end: number } {
  const from = analysis.starts[start] ?? analysis.original.length;
  const to = analysis.ends[Math.max(start, end - 1)] ?? analysis.original.length;
  return { start: from, end: Math.max(from, to) };
}

/** Number of word-like tokens (containing a letter of any script). */
export function countWords(analysis: AnalysisText): number {
  return analysis.text.split(/\s+/u).filter((token) => /\p{L}/u.test(token)).length;
}

const SINHALA = /[඀-෿]/u;
const TAMIL = /[஀-௿]/u;

/** Scripts other than Latin that appear in the content (used for language-coverage reporting). */
export function containsSinhalaOrTamil(analysis: AnalysisText): boolean {
  return SINHALA.test(analysis.text) || TAMIL.test(analysis.text);
}
