import { ApiError, SessionExpiredError } from "../auth/auth-client";
import { AUTH_API_MESSAGES } from "./constants";

/**
 * Simple, safe messages for the person using the app. Raw API messages are never shown for
 * failures (only field-level validation messages, which the API writes for end users), and nothing
 * here reveals tokens or internal details.
 */
export const MESSAGES = {
  tooManyRequests: "FinVoice is busy right now. Please wait a minute and try again.",
  accountInactive: "This account cannot be used. Please start again.",
  sessionExpired: "Your session has ended. Please start again.",
  validation: "Some details need attention. Please check the fields below.",
  unavailable: "FinVoice is not available right now. Please try again in a few minutes.",
  notFound: "We could not find that.",
  unexpected: "Something went wrong. Please try again.",
} as const;

/** One friendly message for any failure of an API call. */
export function friendlyError(error: unknown): string {
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
    return MESSAGES.validation;
  }
  if (error.status === 401) {
    return error.message === AUTH_API_MESSAGES.authenticationFailed
      ? MESSAGES.accountInactive
      : MESSAGES.sessionExpired;
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
