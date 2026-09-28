import { ApiError, SessionExpiredError } from "../auth/auth-client";
import { AUTH_API_MESSAGES } from "./constants";

/**
 * Simple, safe messages for the person using the app. Raw API messages are never shown for
 * failures (only field-level validation messages, which the API writes for end users), and nothing
 * here reveals codes, tokens or internal details.
 */
export const MESSAGES = {
  invalidPhone: "Enter your mobile number in international format, for example +94771234567.",
  invalidCodeFormat: "Enter the 8-digit code from your message.",
  codeIncorrect: "That code is not correct, or it has expired. Check it, or send a new code.",
  codeExpired: "This code has expired. Send a new code to continue.",
  tooManyAttempts: "Too many incorrect attempts. Send a new code to try again.",
  tooManyRequests:
    "Too many codes have been requested for this number. Please wait 15 minutes and try again.",
  accountInactive: "This account cannot sign in. Please contact FinVoice support.",
  sessionExpired: "Your session has ended. Please sign in again.",
  validation: "Some details need attention. Please check the fields below.",
  unavailable: "FinVoice is not available right now. Please try again in a few minutes.",
  notFound: "We could not find that.",
  unexpected: "Something went wrong. Please try again.",
} as const;

export type MessageContext = "requestOtp" | "verifyOtp" | "account";

/** One friendly message for any failure of an API call. */
export function friendlyError(error: unknown, context: MessageContext = "account"): string {
  if (error instanceof SessionExpiredError) {
    return MESSAGES.sessionExpired;
  }
  if (!(error instanceof ApiError)) {
    return MESSAGES.unexpected;
  }
  if (error.status === 0 || error.status >= 500) {
    return MESSAGES.unavailable;
  }
  if (error.status === 429) {
    return MESSAGES.tooManyRequests;
  }
  if (error.status === 400) {
    if (context === "requestOtp") {
      return MESSAGES.invalidPhone;
    }
    if (context === "verifyOtp") {
      return MESSAGES.invalidCodeFormat;
    }
    return MESSAGES.validation;
  }
  if (error.status === 401) {
    if (error.message === AUTH_API_MESSAGES.authenticationFailed) {
      return MESSAGES.accountInactive;
    }
    return context === "verifyOtp" ? MESSAGES.codeIncorrect : MESSAGES.sessionExpired;
  }
  if (error.status === 404) {
    return MESSAGES.notFound;
  }
  return MESSAGES.unexpected;
}

/**
 * Field-level validation messages from a 400 response, keyed by field ("monthlyIncome"). The API
 * writes these for end users ("Must be greater than 0"); they contain no internal details.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.status !== 400) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const detail of error.details) {
    if (detail.field !== null && !(detail.field in result)) {
      result[detail.field] = detail.message;
    }
  }
  return result;
}
