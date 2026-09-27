import { z } from "zod";

import { uuidSchema } from "./common.js";
import { KNOWLEDGE_CATEGORIES, type KnowledgeCategory } from "./knowledge.js";

/**
 * Contracts of the financial-literacy layer (Step 8): the user's learning level and their progress
 * per topic. Only the token-protected internal API uses them; there is no public endpoint.
 *
 * The level is a learning level, not a rating of intelligence or competence. It changes only
 * through explicit application logic (a formal assessment or an authorised update), never from
 * what the user says in a conversation, and there is no numeric score.
 */

export const LITERACY_LEVELS = ["BEGINNER", "DEVELOPING", "CONFIDENT"] as const;
export type LiteracyLevel = (typeof LITERACY_LEVELS)[number];
export const literacyLevelSchema = z.enum(LITERACY_LEVELS, {
  error: "Must be one of: BEGINNER, DEVELOPING, CONFIDENT",
});

/** Literacy topics are the knowledge-base categories, so progress and content share one list. */
export const LITERACY_TOPICS = KNOWLEDGE_CATEGORIES;
export type LiteracyTopic = KnowledgeCategory;
export const literacyTopicSchema = z.enum(LITERACY_TOPICS, {
  error: `Must be one of: ${LITERACY_TOPICS.join(", ")}`,
});

export const LITERACY_TOPIC_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"] as const;
export type LiteracyTopicStatus = (typeof LITERACY_TOPIC_STATUSES)[number];

/** The assessment definition used when no formal assessment has been done yet. */
export const DEFAULT_ASSESSMENT_VERSION = "1";

export const assessmentVersionSchema = z
  .string({ error: "Must be a string" })
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/, {
    error: 'Must be a short version identifier such as "1" or "2026.1"',
  });

/** Path parameters of the topic-progress routes. */
export const literacyTopicParamsSchema = z.strictObject({
  userId: uuidSchema,
  topic: literacyTopicSchema,
});
export type LiteracyTopicParams = z.output<typeof literacyTopicParamsSchema>;

/**
 * Body of PUT /internal/users/:userId/literacy/profile: an explicit level change by an
 * assessment or an authorised system. All fields are required, so nothing changes by omission.
 * `assessedAt` is when the assessment happened (ISO 8601 with offset), or null if the change is not
 * the result of an assessment; it must not be in the future (checked by the service).
 */
export const updateLiteracyProfileRequestSchema = z.strictObject({
  level: literacyLevelSchema,
  assessmentVersion: assessmentVersionSchema,
  assessedAt: z.iso
    .datetime({ offset: true, error: "Must be an ISO 8601 date-time with an offset" })
    .nullable(),
});
export type UpdateLiteracyProfileRequest = z.input<typeof updateLiteracyProfileRequestSchema>;
export type UpdateLiteracyProfileCommand = z.output<typeof updateLiteracyProfileRequestSchema>;

export type LiteracyProfileResponse = {
  level: LiteracyLevel;
  assessmentVersion: string;
  /** Null: the user has not completed a formal literacy assessment yet. */
  assessedAt: string | null;
};

export type LiteracyTopicProgressResponse = {
  topic: LiteracyTopic;
  status: LiteracyTopicStatus;
  startedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string | null;
};

/**
 * The user's literacy state: level and the progress recorded so far. Topics without a record are
 * NOT_STARTED and are not listed. No ids.
 */
export type LiteracyContextResponse = LiteracyProfileResponse & {
  topics: LiteracyTopicProgressResponse[];
};
