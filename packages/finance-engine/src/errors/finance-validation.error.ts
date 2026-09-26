export type FinanceValidationIssue = {
  /** The input field that is invalid, or null for the input as a whole. */
  field: string | null;
  message: string;
};

/**
 * Thrown when a calculation input is invalid. The engine validates every input before
 * calculating and never rounds or otherwise "repairs" an invalid value. Messages are safe to show
 * to API clients.
 */
export class FinanceValidationError extends Error {
  constructor(readonly issues: readonly FinanceValidationIssue[]) {
    super(`Invalid calculation input: ${issues.map(describeIssue).join("; ")}`);
    this.name = "FinanceValidationError";
  }
}

function describeIssue(issue: FinanceValidationIssue): string {
  return issue.field === null ? issue.message : `${issue.field}: ${issue.message}`;
}
