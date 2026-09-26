import type { PrismaClient } from "../../src/generated/prisma/client.js";

const DAY = 24 * 60 * 60 * 1000;

/** A fictional source (".test" is a reserved top-level domain). */
export const FIXTURE_SOURCE = {
  publisher: "Test Publisher",
  title: "Test source document",
  url: "https://source.test/knowledge",
};

/**
 * A small, fully controlled knowledge base covering every retrieval rule:
 *
 * | slug                  | category             | status    | translations | notes                    |
 * | --------------------- | -------------------- | --------- | ------------ | ------------------------ |
 * | saving-basics         | SAVING               | PUBLISHED | EN, SI       |                          |
 * | spot-a-scam           | SCAMS                | PUBLISHED | EN           | body contains "50%"      |
 * | coverage-overdue      | DEPOSIT_PROTECTION   | PUBLISHED | EN           | time-sensitive, overdue  |
 * | coverage-current      | DEPOSIT_PROTECTION   | PUBLISHED | EN           | time-sensitive, current  |
 * | budget-draft          | BUDGETING            | DRAFT     | EN           | must never be public     |
 * | rights-archived       | CONSUMER_PROTECTION  | ARCHIVED  | EN           | must never be public     |
 * | borrowing-sinhala-only| BORROWING            | PUBLISHED | SI           | no English: not public   |
 */
export async function createKnowledgeFixtures(prisma: PrismaClient): Promise<void> {
  const now = Date.now();
  const source = await prisma.knowledgeSource.create({
    data: {
      ...FIXTURE_SOURCE,
      sourceType: "OFFICIAL_REGULATOR",
      originalLanguage: "EN",
      retrievedAt: new Date(now - 10 * DAY),
      lastVerifiedAt: new Date(now - 10 * DAY),
      nextReviewAt: new Date(now + 355 * DAY),
    },
  });

  const article = async (
    slug: string,
    fields: {
      category:
        | "SAVING"
        | "SCAMS"
        | "DEPOSIT_PROTECTION"
        | "BUDGETING"
        | "CONSUMER_PROTECTION"
        | "BORROWING";
      status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
      timeSensitive?: { lastReviewedDaysAgo: number; nextReviewInDays: number };
      translations: Partial<
        Record<
          "EN" | "SI" | "TA",
          { title: string; summary: string; body: string; keywords: string[] }
        >
      >;
    },
  ) => {
    await prisma.knowledgeArticle.create({
      data: {
        slug,
        category: fields.category,
        status: fields.status,
        sourceId: source.id,
        sourceSection: "Section 1",
        isTimeSensitive: fields.timeSensitive !== undefined,
        ...(fields.timeSensitive
          ? {
              lastReviewedAt: new Date(now - fields.timeSensitive.lastReviewedDaysAgo * DAY),
              nextReviewAt: new Date(now + fields.timeSensitive.nextReviewInDays * DAY),
            }
          : {}),
        translations: {
          create: Object.entries(fields.translations).map(([language, text]) => ({
            language: language as "EN" | "SI" | "TA",
            ...text,
            translationStatus: "MACHINE_ASSISTED" as const,
          })),
        },
      },
    });
  };

  await article("saving-basics", {
    category: "SAVING",
    status: "PUBLISHED",
    translations: {
      EN: {
        title: "Saving basics",
        summary: "Why saving helps.",
        body: "Savings help on a rainy day.",
        keywords: ["saving", "savings"],
      },
      SI: {
        title: "ඉතිරි කිරීමේ මූලික කරුණු",
        summary: "ඉතිරි කිරීම උපකාරී වන්නේ ඇයි.",
        body: "ඉතිරි කිරීම හදිසි අවස්ථාවකදී උපකාරී වේ.",
        keywords: ["ඉතිරි කිරීම"],
      },
    },
  });
  await article("spot-a-scam", {
    category: "SCAMS",
    status: "PUBLISHED",
    translations: {
      EN: {
        title: "Spot a scam",
        summary: "Warning signs of fraud.",
        body: "A promise of 50% returns in a month is a warning sign.",
        keywords: ["scam", "fraud"],
      },
    },
  });
  await article("coverage-overdue", {
    category: "DEPOSIT_PROTECTION",
    status: "PUBLISHED",
    timeSensitive: { lastReviewedDaysAgo: 400, nextReviewInDays: -35 },
    translations: {
      EN: {
        title: "Coverage (overdue)",
        summary: "Old limit.",
        body: "A limit that may have changed.",
        keywords: [],
      },
    },
  });
  await article("coverage-current", {
    category: "DEPOSIT_PROTECTION",
    status: "PUBLISHED",
    timeSensitive: { lastReviewedDaysAgo: 10, nextReviewInDays: 80 },
    translations: {
      EN: {
        title: "Coverage (current)",
        summary: "Current limit.",
        body: "A recently checked limit.",
        keywords: [],
      },
    },
  });
  await article("budget-draft", {
    category: "BUDGETING",
    status: "DRAFT",
    translations: {
      EN: {
        title: "Draft budget secret",
        summary: "Unreviewed.",
        body: "Unpublished draft text.",
        keywords: ["saving"],
      },
    },
  });
  await article("rights-archived", {
    category: "CONSUMER_PROTECTION",
    status: "ARCHIVED",
    translations: {
      EN: {
        title: "Archived rights",
        summary: "Withdrawn.",
        body: "Withdrawn archived text about saving.",
        keywords: ["saving"],
      },
    },
  });
  await article("borrowing-sinhala-only", {
    category: "BORROWING",
    status: "PUBLISHED",
    translations: {
      SI: {
        title: "ණය ගැනීම",
        summary: "සිංහලෙන් පමණි.",
        body: "ඉංග්‍රීසි පෙළක් නැත.",
        keywords: [],
      },
    },
  });
}

export const PUBLIC_SLUGS = [
  "coverage-current",
  "coverage-overdue",
  "saving-basics",
  "spot-a-scam",
];
