-- Knowledge refresh (Step 9), part 2: the English summary of "consumer-rights-and-complaints" also
-- names the FCRD inquiries hotline (1935), so references to the article (for example ScamShield's
-- REPORT_SUSPICIOUS_ACTIVITY action, which returns the title, summary and source) show it.
--
-- Data only; no schema change. Guarded like 20260927200000_knowledge_fcrd_hotline: the summary is
-- changed only while it still holds exactly the previously seeded text, so an edited summary is
-- never overwritten. On an empty database nothing matches and the seed inserts the current content.
-- The texts match prisma/knowledge/content.ts and prisma/knowledge/refresh/20260927-fcrd-hotline.ts;
-- tests check that they agree.

UPDATE "knowledge_article_translations"
SET "summary" = $knowledge$You have the right to fair treatment, clear information and privacy. If you have a problem, complain to the financial institution first. For inquiries, the Central Bank's FCRD hotline is 1935.$knowledge$,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "language" = 'EN'
  AND "article_id" IN (SELECT "id" FROM "knowledge_articles" WHERE "slug" = 'consumer-rights-and-complaints')
  AND "summary" = $knowledge$You have the right to fair treatment, clear information and privacy. If you have a problem, complain to the financial institution first.$knowledge$;
