/**
 * Redaction for logs and error messages.
 *
 * The rule is: DO NOT LOG USER CONTENT. ScamShield and the API never log submitted content or
 * evidence. This utility is only a safety net for text that might reach a log unexpectedly (for
 * example an error message that quotes input); it is not permission to log content.
 *
 * It replaces, in this order: e-mail addresses, web addresses, labelled secrets ("password: …",
 * "OTP is …"), card-like digit sequences, phone numbers and remaining OTP-like codes.
 */

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
const URL =
  /(?:https?:\/\/|www\.)[^\s<>"']+|(?<![\p{L}\p{N}@.])(?:[a-z0-9-]+\.)+(?:com|net|org|lk|info|xyz|top|ly|link|site|online|club|app|io|me|co|biz|live|shop|store|click|gl|cc|at|in|us|to|id)(?:\/[^\s<>"']*)?(?![\p{L}\p{N}])/giu;
const LABELLED_SECRET =
  /((?<![\p{L}\p{N}])(?:password|passcode|passwd|pwd|pin|otp|cvv|cvc|code|මුරපදය|මුරපද|கடவுச்சொல்)(?![\p{L}\p{N}]))(\s*(?:is|was|:|=|-|number|no\.?)?\s*)[^\s,.;]+/giu;
const CARD_LIKE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/gu;
const PHONE =
  /(?<!\d)(?:(?:\+|00)94[ -]?\d{2}[ -]?\d{3}[ -]?\d{4}|0\d{2}[ -]?\d{3}[ -]?\d{4}|\d{9,11})(?!\d)/gu;
const OTP_LIKE = /(?<!\d)\d{4,8}(?!\d)/gu;

export function redactSensitiveText(value: string): string {
  return value
    .replace(EMAIL, "[email]")
    .replace(URL, "[link]")
    .replace(LABELLED_SECRET, "$1$2[redacted]")
    .replace(CARD_LIKE, "[card number]")
    .replace(PHONE, "[phone]")
    .replace(OTP_LIKE, "[code]");
}

/** Masks card-like digit sequences (13–19 digits) in evidence shown back to the user. */
export function maskCardNumbers(value: string): string {
  return value.replace(CARD_LIKE, "[card number]");
}
