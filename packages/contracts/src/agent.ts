import { z } from "zod";

import {
  budgetCalculationRequestSchema,
  loanCalculationRequestSchema,
  savingsCalculationRequestSchema,
} from "./calculations.js";
import {
  knowledgeCategorySchema,
  knowledgeLanguageSchema,
  knowledgeSlugSchema,
  type KnowledgeLanguage,
} from "./knowledge.js";

/**
 * Contracts of the AI agent API (/api/v1/agent) and of the tools the agent may call.
 *
 * The client sends a message and, optionally, a response language. Everything else (system
 * instructions, tools, model, generation settings, tool results) is controlled by the server, so
 * any other request field is rejected.
 */

export type AgentLanguage = KnowledgeLanguage;

export const AGENT_MESSAGE_MAX_LENGTH = 2000;

export const agentChatRequestSchema = z.strictObject({
  message: z
    .string({ error: "Must be a string" })
    .trim()
    .min(1, { error: "Must not be empty" })
    .max(AGENT_MESSAGE_MAX_LENGTH, {
      error: `Must be at most ${String(AGENT_MESSAGE_MAX_LENGTH)} characters`,
    }),
  /** Language of the answer. Defaults to EN. */
  language: knowledgeLanguageSchema.default("EN"),
});
export type AgentChatRequest = z.input<typeof agentChatRequestSchema>;
export type AgentChatCommand = z.output<typeof agentChatRequestSchema>;

/** The only tools the agent can use. The server executes them; the model only requests them. */
export const AGENT_TOOL_NAMES = [
  "search_knowledge",
  "get_knowledge_article",
  "calculate_loan",
  "calculate_savings",
  "calculate_budget",
] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export type AgentChatResponse = {
  /** The agent's answer, in `language`. */
  message: string;
  language: AgentLanguage;
  /** Identifies the agent's behaviour (instructions, tools, policies). */
  agentVersion: string;
  /** The tools the agent used for this answer, in first-use order, without their arguments. */
  usedTools: AgentToolName[];
};

// ---------------------------------------------------------------------------
// Tool inputs. Arguments produced by the model are untrusted: they are validated against these
// schemas (and again by the finance engine / knowledge service) before any tool runs.
// ---------------------------------------------------------------------------

export const SEARCH_KNOWLEDGE_QUERY_MAX_LENGTH = 100;

export const searchKnowledgeToolInputSchema = z.strictObject({
  query: z
    .string({ error: "Must be a string" })
    .trim()
    .min(1, { error: "Must not be empty" })
    .max(SEARCH_KNOWLEDGE_QUERY_MAX_LENGTH, {
      error: `Must be at most ${String(SEARCH_KNOWLEDGE_QUERY_MAX_LENGTH)} characters`,
    }),
  language: knowledgeLanguageSchema.optional(),
  category: knowledgeCategorySchema.optional(),
});
export type SearchKnowledgeToolInput = z.output<typeof searchKnowledgeToolInputSchema>;

export const getKnowledgeArticleToolInputSchema = z.strictObject({
  slug: knowledgeSlugSchema,
  language: knowledgeLanguageSchema.optional(),
});
export type GetKnowledgeArticleToolInput = z.output<typeof getKnowledgeArticleToolInputSchema>;

/** Calculation tools take exactly the calculation API's inputs: results can never be supplied. */
export const calculateLoanToolInputSchema = loanCalculationRequestSchema;
export const calculateSavingsToolInputSchema = savingsCalculationRequestSchema;
export const calculateBudgetToolInputSchema = budgetCalculationRequestSchema;
