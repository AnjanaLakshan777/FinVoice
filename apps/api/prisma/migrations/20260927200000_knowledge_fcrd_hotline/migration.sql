-- Knowledge refresh (Step 9): the FCRD "Hotline for Inquiries" (1935) in the existing article
-- "consumer-rights-and-complaints", which becomes time-sensitive (reviewed every 3 months), and the
-- re-check of its source, https://www.cbsl.gov.lk/en/fcrd (27 September 2026).
--
-- Data only; no schema change. The knowledge seed is insert-only, so databases seeded before this
-- refresh are updated here. Every UPDATE is guarded: it changes a record only while the record
-- still holds exactly the previously seeded values, so content edited in the database is never
-- overwritten. On an empty database (a new installation) nothing matches and the seed inserts
-- the current content. Generated from prisma/knowledge/content.ts and
-- prisma/knowledge/refresh/20260927-fcrd-hotline.ts; tests check that they agree.

UPDATE "knowledge_sources"
SET "retrieved_at" = '2026-09-27T12:00:00.000Z'::timestamptz,
    "last_verified_at" = '2026-09-27T12:00:00.000Z'::timestamptz,
    "next_review_at" = '2026-12-27T12:00:00.000Z'::timestamptz,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "url" = 'https://www.cbsl.gov.lk/en/fcrd'
  AND "retrieved_at" = '2026-09-26T08:00:00.000Z'::timestamptz
  AND "last_verified_at" = '2026-09-26T08:00:00.000Z'::timestamptz
  AND "next_review_at" = '2027-09-26T08:00:00.000Z'::timestamptz;

UPDATE "knowledge_articles"
SET "source_section" = $knowledge$Financial consumer rights and responsibilities; complaint handling; contact details (Hotline for Inquiries)$knowledge$,
    "is_time_sensitive" = true,
    "last_reviewed_at" = '2026-09-27T12:00:00.000Z'::timestamptz,
    "next_review_at" = '2026-12-27T12:00:00.000Z'::timestamptz,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'consumer-rights-and-complaints'
  AND "source_section" = $knowledge$Financial consumer rights and responsibilities; complaint handling$knowledge$
  AND "is_time_sensitive" = false
  AND "last_reviewed_at" = '2026-09-26T08:00:00.000Z'::timestamptz
  AND "next_review_at" = '2027-09-26T08:00:00.000Z'::timestamptz;

UPDATE "knowledge_article_translations"
SET "body" = $knowledge$The Central Bank of Sri Lanka lists these rights of financial consumers:
- to be treated fairly by financial service providers
- to complain, and to get a satisfactory answer within a reasonable time
- to have your financial information kept private and confidential
- to have access to suitable financial products and services
- to receive information that is complete, clear, short, accurate and not misleading

If you have a complaint:
- First, complain to the financial institution concerned.
- If you are not satisfied with its answer, you can take your complaint to the Central Bank's Financial Consumer Relations Department (FCRD).

For inquiries, the FCRD has a hotline: 1935. Contact details can change, so check the Central Bank of Sri Lanka's website for the latest details.

You also have responsibilities, such as understanding the terms before you agree, giving accurate information and taking care in every transaction.$knowledge$,
    "keywords" = ARRAY['rights', 'complaint', 'complaints', 'fcrd', 'consumer protection', 'privacy', 'hotline', '1935', 'inquiries']::TEXT[],
    "updated_at" = CURRENT_TIMESTAMP
WHERE "language" = 'EN'
  AND "article_id" IN (SELECT "id" FROM "knowledge_articles" WHERE "slug" = 'consumer-rights-and-complaints')
  AND "body" = $knowledge$The Central Bank of Sri Lanka lists these rights of financial consumers:
- to be treated fairly by financial service providers
- to complain, and to get a satisfactory answer within a reasonable time
- to have your financial information kept private and confidential
- to have access to suitable financial products and services
- to receive information that is complete, clear, short, accurate and not misleading

If you have a complaint:
- First, complain to the financial institution concerned.
- If you are not satisfied with its answer, you can take your complaint to the Central Bank's Financial Consumer Relations Department (FCRD).

You also have responsibilities, such as understanding the terms before you agree, giving accurate information and taking care in every transaction.$knowledge$
  AND "keywords" = ARRAY['rights', 'complaint', 'complaints', 'fcrd', 'consumer protection', 'privacy']::TEXT[];
