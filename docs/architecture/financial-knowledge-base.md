# Financial knowledge base

> **Status:** Step 5. Curated, source-backed financial-literacy articles stored in PostgreSQL and served by a read-only API with deterministic retrieval ([domain-api.md](../api/domain-api.md#knowledge)). No RAG, embeddings or AI-generated content.

## 1. Purpose

FinVoice explains money matters to people who may have little financial knowledge, limited digital skills and no access to financial education. When a future voice assistant explains saving, scams or deposit insurance, **what it says must be true and traceable**.

The knowledge base is the authoritative store of that explanatory content. Every article is plain-language text based on an identified official source, with the source recorded next to it.

## 2. Architecture

```text
Factual knowledge                          Financial calculation
        ↓                                           ↓
Knowledge base (this document)             Finance engine (Step 4)
  PostgreSQL: sources, articles,             pure functions, exact decimals
  translations
        ↓                                           ↓
GET /api/v1/knowledge/…                    POST /api/v1/calculations/…
        ↓                                           ↓
                 Future AI layer: explains, never invents
```

| Part                   | Location                                                                       |
| ---------------------- | ------------------------------------------------------------------------------ |
| Tables and constraints | `apps/api/prisma/schema.prisma`, migration `20260926081151_knowledge_base`     |
| Curated content        | `apps/api/prisma/knowledge/content.ts`                                         |
| Seed (insert-only)     | `apps/api/prisma/knowledge/seed-knowledge.ts`, run by `pnpm db:seed:knowledge` |
| Retrieval              | `apps/api/src/knowledge/` (service, mapper, read-only controller)              |
| API contracts          | `packages/contracts/src/knowledge.ts`                                          |

## 3. Source hierarchy

Sources are ranked by `sourceType`, and more authoritative sources are preferred:

1. `OFFICIAL_REGULATOR`: for example the Central Bank of Sri Lanka (CBSL). **All initial content comes from here.**
2. `OFFICIAL_GOVERNMENT`
3. `OFFICIAL_FINANCIAL_INSTITUTION`: only for facts about that institution itself.
4. `EDUCATIONAL`
5. `OTHER`

**The source rule:** if a claim cannot be supported by an identified source, it is not published as knowledge. Laws, regulations, rates, limits, programmes, guarantees and contact details are never invented.

The initial sources (all CBSL, all read and checked on 26 September 2026):

| Source                                                                                                                                                                                                                                     | Used for                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Financial Literacy Curriculum (PDF), Chapter 3                                                                                                                                                                                             | Why saving matters, simple budget, emergency savings              |
| Financial Literacy Roadmap of Sri Lanka 2024-2028 (launch notice, 21 May 2024)                                                                                                                                                             | Why financial literacy matters                                    |
| Financial Consumer Relations Department (FCRD) page                                                                                                                                                                                        | Responsible borrowing, understanding terms, rights and complaints |
| Be Scam Proof: the page, its posters 'Don't Recognize a Transaction? Don't Ignore It!' and 'Your password and PIN are like your toothbrush!', and the linked FIU booklet 'Financial Scams: The Hell Underneath The Heaven' (December 2023) | Recognising scams, what to do about suspicious activity           |
| Beware of Online Scams - Protect Your Bank Passwords and PINs (21 Nov 2019)                                                                                                                                                                | Keeping your PIN, OTP and passwords secret                        |
| Adopting Safe and Secure Electronic Payment Practices (1 Aug 2019)                                                                                                                                                                         | Safe digital payments                                             |
| Sri Lanka Deposit Insurance Scheme page                                                                                                                                                                                                    | Deposit insurance (time-sensitive)                                |

The suspicious-activity article was re-based on the current Be Scam Proof material (re-read on 26 September 2026): it gives the warning signs and the immediate steps, and the linked FIU booklet says to complain to the police and report to the bank. **That material names channels (your bank, the police) but gives no hotline numbers or other contact details, so the article states none.** The 2019 notice remains a source because the PIN/OTP/password article relies on it (it is the notice that lists card details such as the CVV).

The Financial Consumer Protection Regulations No. 01 of 2023 page was also checked. But it is an index page that does not itself state the principles, so no article cites it, and it is not recorded as a source.

## 4. Article model

`knowledge_articles`: one row per piece of knowledge, independent of language.

| Field                                                     | Meaning                                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `slug`                                                    | Stable public id, kebab-case, unique (`deposit-insurance`)                                                                                |
| `category`                                                | `SAVING`, `BUDGETING`, `BORROWING`, `DIGITAL_FINANCE`, `CONSUMER_PROTECTION`, `SCAMS`, `DEPOSIT_PROTECTION`, `GENERAL_FINANCIAL_LITERACY` |
| `status`                                                  | `DRAFT` (default), `PUBLISHED`, `ARCHIVED`                                                                                                |
| `audience`                                                | `GENERAL_PUBLIC` (default), `YOUNG_ADULT`, `LOW_DIGITAL_LITERACY`, `SMALL_BUSINESS`, `OTHER`                                              |
| `source_id`, `source_section`                             | The source and the part of it the article is based on                                                                                     |
| `is_time_sensitive`, `last_reviewed_at`, `next_review_at` | See §7–8                                                                                                                                  |

`knowledge_sources`: one row per document (unique URL), shared by all the articles based on it. It records publisher, title, URL, type, original language, publication date (if the source states one), when the content was retrieved, when it was last verified, and when it is next due for review.

**Relationships:**

- An article → its source: `ON DELETE RESTRICT`. A source cannot be deleted while any article cites it.
- A translation → its article: `ON DELETE CASCADE`. Translations belong to their article.

**Indexes** (each serves a query that exists):

| Index                                                             | Serves                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `knowledge_articles_slug_key` (unique)                            | `GET /knowledge/articles/:slug`                                                                   |
| `knowledge_articles_status_category_idx`                          | Published articles, optionally in one category (list and category endpoints)                      |
| `knowledge_articles_source_id_idx`                                | The foreign key: finding the articles of a source (for example when deleting it) without scanning |
| `knowledge_article_translations_article_id_language_key` (unique) | One translation per language; loading an article's translations                                   |
| `knowledge_sources_url_key` (unique)                              | One record per document; the seed's lookup by URL                                                 |

`(status, next_review_at)` is deliberately **not** indexed yet. No query filters on review dates today: `reviewRequired` is computed for each returned row. The index belongs with the future review workflow ("list articles due for review").

**Database-enforced rules** (CHECK constraints in the migration):

- A `PUBLISHED` article has a source.
- A time-sensitive article has both review dates, and the next review comes after the last one.
- Slugs are kebab-case.
- Source URLs are `https://`, and a source's next review comes after its last verification.
- No text is blank, and keywords are never `NULL`.

## 5. Translation model

`knowledge_article_translations`: the title, summary, body and keywords of an article in one language (`EN`, `SI` or `TA`, the same `language` enum as users), unique per article and language.

- **English is canonical.** Every public article must have English text. Other languages are translations of it.
- **A translation is not a new fact.** It must not add claims, numbers or rules. Content tests check that translations contain no number that is missing from the English text, and that they have the same paragraph and list structure.
- The body is plain text: paragraphs are separated by blank lines, and list items start with `- `. That reads well on screen and aloud.

## 6. Translation status and source attribution

Each translation has a `translationStatus`, returned with every response:

| Status             | Meaning                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| `OFFICIAL`         | The source's own published wording in that language                        |
| `HUMAN_REVIEWED`   | Checked by a qualified person against the source                           |
| `MACHINE_ASSISTED` | Drafted with machine assistance and not yet reviewed by a qualified person |

**All initial content is `MACHINE_ASSISTED`.** That includes the English: it is FinVoice's own plain-language wording of the sources (drafted with AI assistance), not CBSL's text. Three articles also have Sinhala and Tamil translations (`why-saving-matters`, `protect-pin-otp-passwords` and `recognise-scams`), and these are machine-assisted as well. Nothing is presented as an official CBSL translation. A qualified reviewer should check the text against the sources before production use, and the status is then changed to `HUMAN_REVIEWED`.

Every response carries its **source attribution**: publisher, title, URL, type, section, and when the source was last verified. The citation is metadata. The API never fetches the source website, so the knowledge base keeps working when that website is unavailable.

## 7. Time-sensitive information

Some facts change: coverage amounts, limits, rules, programmes and contact details. Articles containing such facts have `is_time_sensitive = true` and **must** have `last_reviewed_at` and `next_review_at` (enforced by the database).

- The deposit insurance limit (currently Rs. 1,100,000 per depositor, per institution) lives **only in the article text**, never in application code. When it changes, the content changes and the code does not.
- Content tests require every article that mentions a rupee amount to be time-sensitive, with a review interval of at most 3 months.

## 8. Review dates and the `reviewRequired` flag

`reviewRequired = isTimeSensitive AND nextReviewAt < now`. It is computed on every request.

An overdue time-sensitive article is **still returned, clearly flagged**, and never silently presented as current:

- It is not hidden, because the general explanation is usually still useful.
- It is not deleted, rewritten or re-sourced automatically.
- The future AI layer must not state its figures as current when `reviewRequired` is `true`. It should point the user to the source instead.

Sources also carry `last_verified_at` and `next_review_at`. The API exposes `lastVerifiedAt`.

## 9. Publication lifecycle

```text
DRAFT ──(source attached, content checked)──▶ PUBLISHED ──(withdrawn)──▶ ARCHIVED
```

- **Only `PUBLISHED` articles with English text are public.**
- `DRAFT` and `ARCHIVED` articles never appear in lists, search results or category counts.
- Requesting an unpublished article by slug gives exactly the same `404` as an unknown slug, so its existence is not revealed.
- **There are no write endpoints.** Content is managed through the reviewed content file and the controlled seed until authenticated administration exists.

**The seed** (`pnpm db:seed:knowledge`) is:

- **insert-only and idempotent**: it adds missing sources, articles and translations by natural key (URL, slug, article + language), and never updates or deletes anything. Content changed in the database is therefore never overwritten. Records that differ from the content file are listed, not changed.
- **separate from the demo seed** (`pnpm db:seed`), because this content is real and meant for every environment.
- **guarded in production**: with `NODE_ENV=production` it refuses to run unless `--allow-production` is passed.

## 10. Search and retrieval

`GET /api/v1/knowledge/articles` uses **deterministic PostgreSQL queries**:

- **Filters:** `category`, and `status = PUBLISHED` (always applied).
- **Search** (`query`): a case-insensitive substring match on the title, summary and body, or an exact match on a keyword. It searches the requested-language translation and the English one, so both Sinhala words and English terms find an article. `%` and `_` are matched literally.
- **Order:** category, then slug. The same query always returns the same results in the same order.
- **Pagination:** `page` ≥ 1, `limit` 1–100, default 20.

There is no ranking, no relevance scoring and no fuzzy matching. That is appropriate for a small curated collection, and every result can be explained.

## 11. Language fallback

When an article has no translation in the requested language, **the English text is returned**, and the response says so:

```json
{ "requestedLanguage": "TA", "language": "EN", "translationStatus": "MACHINE_ASSISTED", "…": "…" }
```

Text is never machine-translated on the fly. A future AI layer can translate the retrieved English text for the listener, and it knows from `language` that it is doing so.

## 12. Why there is no RAG yet

Retrieval-augmented generation (embeddings, vector search, re-ranking) solves "find the relevant passages in a large, unstructured corpus". FinVoice has 12 curated articles. At this size:

- deterministic filters and substring search are enough, and are fully predictable;
- results can be tested exactly and explained to a reviewer;
- there is no embedding model, vector store or extra infrastructure to run, secure and pay for.

No pgvector, LangChain, LlamaIndex or embedding SDK is installed.

## 13. Why AI is not the source of truth

Language models can produce fluent, confident statements that are wrong, outdated or unsourced. For regulation, deposit protection or scam advice, that is harmful. So:

- facts come from the knowledge base, with a citation;
- numbers come from the finance engine;
- the AI's job is to understand the question, retrieve, and explain in the caller's language. It never originates financial facts or figures.

## 14. Relationship with the finance engine

The knowledge base explains concepts ("what is a reducing-balance loan?"). The finance engine (`packages/finance-engine`) calculates ("what is my monthly payment?"). **Knowledge content contains no formulas and knowledge code performs no calculations.** A content test rejects formula-like text in articles. An explanation that needs a figure should call the calculation API.

## 15. Future path towards RAG

The model already supports it: stable slugs, English canonical text, per-language translations, keywords, sources and review metadata. When the collection grows, or free-form questions need better recall:

1. Add an embeddings table keyed by translation id, with the embedding-model version, rebuilt from **published** text only.
2. Use vector search to _retrieve candidates_, and keep publication, review and source rules exactly as they are.
3. Keep returning the same response shape, including source and `reviewRequired`, so the AI layer's safety rules do not change.

## 16. Content governance

| Rule                                  | How it is enforced                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Every public claim has a source       | Database CHECK (a published article has a source); content tests; editorial review                                 |
| Plain language                        | Short sentences and simple words; examples are labelled "for example"                                              |
| No advice or promises                 | No product, bank or loan recommendations, no guarantees, no personal advice (content test catches obvious phrases) |
| No stale figures presented as current | Time-sensitive flag, review dates, `reviewRequired`                                                                |
| No false authority                    | `translationStatus`: nothing is `OFFICIAL` unless the source published that text                                   |
| Traceable changes                     | Content lives in version-controlled `content.ts`; the seed never overwrites the database                           |
| Regular re-verification               | Sources and articles have `next_review_at`: yearly, and every 3 months for time-sensitive facts                    |

**Before production:**

- A qualified reviewer checks every article against its source.
- A qualified translator reviews the Sinhala and Tamil text.
- The reviewed records are marked `HUMAN_REVIEWED`.
