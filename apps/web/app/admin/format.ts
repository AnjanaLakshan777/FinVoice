import type {
  AnalyticsEventType,
  AnalyticsToolName,
  KnowledgeCategory,
  KnowledgeReviewBucket,
  Language,
  ScamShieldRiskLevel,
  ScamSourceType,
} from "@finvoice/contracts";

export const LANGUAGE_LABELS: Record<Language, string> = {
  SI: "Sinhala",
  TA: "Tamil",
  EN: "English",
};

export const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  SAVING: "Saving",
  BUDGETING: "Budgeting",
  BORROWING: "Borrowing",
  DIGITAL_FINANCE: "Digital finance",
  CONSUMER_PROTECTION: "Consumer protection",
  SCAMS: "Scams",
  DEPOSIT_PROTECTION: "Deposit protection",
  GENERAL_FINANCIAL_LITERACY: "General financial literacy",
};

export const RISK_LABELS: Record<ScamShieldRiskLevel, string> = {
  INSUFFICIENT_INFORMATION: "Insufficient information",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export const SOURCE_TYPE_LABELS: Record<ScamSourceType, string> = {
  MESSAGE: "Message",
  EMAIL: "Email",
  CALL: "Call",
  SOCIAL_MEDIA: "Social media",
  WEBSITE: "Website",
  OFFER: "Offer",
  UNKNOWN: "Unknown",
};

export const EVENT_TYPE_LABELS: Record<AnalyticsEventType, string> = {
  AGENT_REQUEST: "AI agent requests",
  AGENT_TOOL_CALL: "AI agent tool calls",
  VOICE_SESSION: "Voice sessions",
  VOICE_TOOL_CALL: "Voice tool calls",
  KNOWLEDGE_SEARCH: "Knowledge searches",
  KNOWLEDGE_ARTICLE_VIEW: "Knowledge article views",
  SCAM_ANALYSIS: "ScamShield analyses",
  LITERACY_TOPIC_STARTED: "Literacy topics started",
  LITERACY_TOPIC_COMPLETED: "Literacy topics completed",
  CALCULATION: "Calculations",
};

export const TOOL_LABELS: Record<AnalyticsToolName, string> = {
  search_knowledge: "Search knowledge",
  get_knowledge_article: "Get knowledge article",
  calculate_loan: "Loan calculator",
  calculate_savings: "Savings calculator",
  calculate_budget: "Budget calculator",
  get_user_financial_context: "User financial context",
  get_user_literacy_context: "User literacy context",
};

export const BUCKET_LABELS: Record<KnowledgeReviewBucket, string> = {
  OVERDUE: "Overdue",
  DUE_WITHIN_7_DAYS: "Due within 7 days",
  DUE_WITHIN_30_DAYS: "Due within 30 days",
  LATER: "Later",
};

const numberFormat = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
  return numberFormat.format(value);
}

export function formatPercentage(value: string | null): string {
  return value === null ? "—" : `${value}%`;
}

/** Milliseconds as "320 ms" or "4.2 s"; "—" when there is no value. */
export function formatMs(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return value < 1000 ? `${formatCount(value)} ms` : `${(value / 1000).toFixed(1)} s`;
}

export function formatDate(iso: string | null): string {
  return iso === null ? "—" : iso.slice(0, 10);
}
