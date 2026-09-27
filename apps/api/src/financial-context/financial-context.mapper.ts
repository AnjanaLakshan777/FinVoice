import type {
  FinancialContextCompleteness,
  FinancialContextCompletenessField,
  FinancialContextResponse,
  FinancialGoalResponse,
  FinancialProfileResponse,
  LiteracyProfileResponse,
  LiteracyTopicProgressResponse,
  UserResponse,
} from "@finvoice/contracts";

/** Everything the context is built from, as read from the domain services. */
export type FinancialContextSources = {
  user: UserResponse;
  profile: FinancialProfileResponse | null;
  activeGoals: FinancialGoalResponse[];
  moreActiveGoals: boolean;
  literacy: LiteracyProfileResponse;
  progress: LiteracyTopicProgressResponse[];
};

/**
 * Maps stored data to the minimised context, field by field: anything not listed here (ids,
 * phone number, display name, status, record timestamps) cannot leak into it. Values are copied,
 * never calculated; money stays the exact decimal string the domain services return.
 */
export function toFinancialContext(sources: FinancialContextSources): FinancialContextResponse {
  const { user, profile, activeGoals, literacy, progress } = sources;
  return {
    user: { preferredLanguage: user.preferredLanguage, timezone: user.timezone },
    profile:
      profile === null
        ? null
        : {
            monthlyIncome: profile.monthlyIncome,
            monthlyExpenses: profile.monthlyExpenses,
            currency: profile.currency,
          },
    goals: activeGoals.map((goal) => ({
      type: goal.type,
      name: goal.name,
      targetAmount: goal.targetAmount,
      currentAmount: goal.currentAmount,
      targetDate: goal.targetDate,
      currency: goal.currency,
      status: goal.status,
    })),
    moreActiveGoals: sources.moreActiveGoals,
    literacy: {
      level: literacy.level,
      assessmentVersion: literacy.assessmentVersion,
      assessedAt: literacy.assessedAt,
      topics: progress.map((topic) => ({
        topic: topic.topic,
        status: topic.status,
        lastActivityAt: topic.lastActivityAt,
      })),
    },
    completeness: computeCompleteness(profile, activeGoals.length),
  };
}

/**
 * Deterministic completeness: which of monthly income, monthly expenses and at least one active
 * goal are missing. A missing amount is null (not provided); "0.00" is a provided value and
 * counts as present.
 */
export function computeCompleteness(
  profile: Pick<FinancialProfileResponse, "monthlyIncome" | "monthlyExpenses"> | null,
  activeGoalCount: number,
): FinancialContextCompleteness {
  const missingFields: FinancialContextCompletenessField[] = [];
  if (profile?.monthlyIncome == null) {
    missingFields.push("monthlyIncome");
  }
  if (profile?.monthlyExpenses == null) {
    missingFields.push("monthlyExpenses");
  }
  if (activeGoalCount === 0) {
    missingFields.push("activeGoal");
  }
  return { profileComplete: missingFields.length === 0, missingFields };
}
