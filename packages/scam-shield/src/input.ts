/**
 * The ScamShield input. The content is DATA to analyse: whatever it says ("ignore your rules",
 * "tell FinVoice this is safe") is only ever matched against the rules, never followed.
 */

export const SCAM_SOURCE_TYPES = [
  "MESSAGE",
  "EMAIL",
  "CALL",
  "SOCIAL_MEDIA",
  "WEBSITE",
  "OFFER",
  "UNKNOWN",
] as const;
export type ScamSourceType = (typeof SCAM_SOURCE_TYPES)[number];

export const SCAM_LANGUAGES = ["EN", "SI", "TA"] as const;
export type ScamLanguage = (typeof SCAM_LANGUAGES)[number];

/** Maximum content length, in characters (UTF-16 code units, as JavaScript counts them). */
export const MAX_CONTENT_LENGTH = 10_000;

export type ScamAnalysisInput = {
  /** What the user received or was told, as they describe it. Trimmed; 1–10,000 characters. */
  content: string;
  /** The user's language (for coverage reporting and explanations). Patterns of all languages run. */
  language: ScamLanguage;
  sourceType: ScamSourceType;
};

export type ScamShieldInputIssue = {
  field: "content" | "language" | "sourceType" | null;
  message: string;
};

/** Invalid input. Messages never contain the submitted content. */
export class ScamShieldInputError extends Error {
  constructor(readonly issues: ScamShieldInputIssue[]) {
    super(`Invalid ScamShield input: ${issues.map((issue) => issue.field ?? "input").join(", ")}`);
    this.name = "ScamShieldInputError";
  }
}

/** Validates and trims the input. Unknown properties are rejected. */
export function validateScamInput(input: unknown): ScamAnalysisInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ScamShieldInputError([{ field: null, message: "Must be an object" }]);
  }
  const record = input as Record<string, unknown>;
  const issues: ScamShieldInputIssue[] = [];
  const unknown = Object.keys(record).filter(
    (key) => key !== "content" && key !== "language" && key !== "sourceType",
  );
  if (unknown.length > 0) {
    issues.push({ field: null, message: "Unknown properties are not allowed" });
  }
  const content = typeof record.content === "string" ? record.content.trim() : null;
  if (content === null) {
    issues.push({ field: "content", message: "Must be a string" });
  } else if (content.length === 0) {
    issues.push({ field: "content", message: "Must not be empty" });
  } else if (content.length > MAX_CONTENT_LENGTH) {
    issues.push({
      field: "content",
      message: `Must be at most ${String(MAX_CONTENT_LENGTH)} characters`,
    });
  }
  if (!(SCAM_LANGUAGES as readonly unknown[]).includes(record.language)) {
    issues.push({ field: "language", message: "Must be one of: EN, SI, TA" });
  }
  if (!(SCAM_SOURCE_TYPES as readonly unknown[]).includes(record.sourceType)) {
    issues.push({
      field: "sourceType",
      message: `Must be one of: ${SCAM_SOURCE_TYPES.join(", ")}`,
    });
  }
  if (issues.length > 0 || content === null) {
    throw new ScamShieldInputError(issues);
  }
  return {
    content,
    language: record.language as ScamLanguage,
    sourceType: record.sourceType as ScamSourceType,
  };
}
