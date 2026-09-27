/**
 * The Step 9 knowledge refresh (27 September 2026): the FCRD "Hotline for Inquiries" in
 * consumer-rights-and-complaints. The seed is insert-only, so databases seeded earlier receive the
 * change through two data migrations, which apply it only where the stored values are still
 * exactly the previously seeded ones (`before`):
 * - 20260927200000_knowledge_fcrd_hotline: source dates, article review data, English body and
 *   keywords;
 * - 20260927210000_knowledge_fcrd_hotline_summary: the English summary (so references to the
 *   article, such as ScamShield's reporting action, show the hotline).
 *
 * `before` is the content as seeded until this refresh; the current content is in ../content.ts.
 * Tests use both to prove the migration turns `before` into the current content, and leaves
 * edited records alone.
 */
export const FCRD_HOTLINE_REFRESH = {
  sourceUrl: "https://www.cbsl.gov.lk/en/fcrd",
  articleSlug: "consumer-rights-and-complaints",
  before: {
    source: {
      retrievedAt: "2026-09-26T08:00:00.000Z",
      lastVerifiedAt: "2026-09-26T08:00:00.000Z",
      nextReviewAt: "2027-09-26T08:00:00.000Z",
    },
    article: {
      sourceSection: "Financial consumer rights and responsibilities; complaint handling",
      isTimeSensitive: false,
      lastReviewedAt: "2026-09-26T08:00:00.000Z",
      nextReviewAt: "2027-09-26T08:00:00.000Z",
    },
    english: {
      summary:
        "You have the right to fair treatment, clear information and privacy. If you have a problem, complain to the financial institution first.",
      body: [
        "The Central Bank of Sri Lanka lists these rights of financial consumers:\n- to be treated fairly by financial service providers\n- to complain, and to get a satisfactory answer within a reasonable time\n- to have your financial information kept private and confidential\n- to have access to suitable financial products and services\n- to receive information that is complete, clear, short, accurate and not misleading",
        "If you have a complaint:\n- First, complain to the financial institution concerned.\n- If you are not satisfied with its answer, you can take your complaint to the Central Bank's Financial Consumer Relations Department (FCRD).",
        "You also have responsibilities, such as understanding the terms before you agree, giving accurate information and taking care in every transaction.",
      ].join("\n\n"),
      keywords: ["rights", "complaint", "complaints", "fcrd", "consumer protection", "privacy"],
    },
  },
} as const;
