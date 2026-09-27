# ScamShield

> **Status:** Step 9. Package [`packages/scam-shield`](../../packages/scam-shield) (engine), API module [`apps/api/src/scam-shield`](../../apps/api/src/scam-shield), endpoint `POST /api/v1/scamshield/analyze` ([domain-api.md](../api/domain-api.md#scamshield)). Rule set version `1`.

## 1. Purpose

ScamShield helps a person decide what to do about a message, call, offer, link or payment request they are unsure about. They describe or paste what they received. ScamShield then lists the **warning indicators** it recognises, shows the words that triggered each one, and points to safe, source-backed actions such as "do not share your OTP" or "contact your bank".

ScamShield does **not** decide, in a legal or factual sense, that something is a scam. It says "high-risk indicators detected", never "this is definitely a scam". When nothing is found, it never says "safe".

## 2. Threat and problem model

The people FinVoice serves include users with limited financial or digital experience. They are targeted by the scam types described in the Central Bank of Sri Lanka's **Be Scam Proof** campaign:

- requests for PINs, passwords and OTPs;
- fake loan approvals;
- lottery and prize scams that need an "advance payment";
- fake investments and plantation schemes;
- unauthorised deposit-taking;
- pyramid schemes;
- account rental;
- phishing links;
- impersonation of banks, the Central Bank or the police.

Most of these scams share a few recognisable steps:

1. They attract attention with a prize, a job or high returns.
2. They build trust, for example by claiming to be official.
3. They create urgency or fear.
4. They ask for credentials, details, money or a click.

ScamShield detects those steps in the text.

What ScamShield defends against:

- a user acting on a scam message before checking it;
- a future AI explanation layer inventing or dropping warnings;
- instructions hidden in the submitted text.

What ScamShield does not attempt:

- checking whether a website, phone number or company is genuine (it has no reputation data);
- monitoring transactions;
- blocking payments;
- reporting to banks or the police.

## 3. Why detection is deterministic

- **Explainable.** Every indicator comes from a named rule, with the exact words that matched.
- **Reproducible.** The same input always gives the same result. Tests can pin the behaviour and reviewers can audit it.
- **Source-grounded.** Every rule is tied to official CBSL material. A language model could produce plausible warnings that no source supports.
- **Private and available.** The check runs in-process. The content never leaves the server, and ScamShield keeps working when Gemini is unavailable.
- **Safe against manipulation.** Text in the content cannot change fixed patterns (see [section 17](#17-future-gemini-integration)).

The cost is recall. Wording the patterns do not cover is not detected, which is why a clean result never means "safe".

## 4. Engine architecture

```text
POST /api/v1/scamshield/analyze
   ↓ contract validation (zod strict object: content, language, sourceType)
ScamShieldService (apps/api)
   ↓ analyzeScam(input)                          ← @finvoice/scam-shield: pure, synchronous
   │    validate → normalize → pattern rules → composite rules
   │    → evidence → risk level → actions
   ↓ structured result (indicator codes, evidence, source slugs, action codes)
KnowledgeService.getPublishedMany(slugs, language)   ← ONE query, published articles only
   ↓
mapper: public response (knowledge references resolved; internal weights dropped)
```

The engine package (`packages/scam-shield`) has **no runtime dependencies**. It imports nothing from NestJS, Prisma, PostgreSQL, the Google SDK or any network API, and a test enforces this. It never calls `KnowledgeService`. It returns article **slugs**, and the API resolves them.

| Module                  | Role                                                                              |
| ----------------------- | --------------------------------------------------------------------------------- |
| `src/input.ts`          | Input model and validation (`ScamShieldInputError` never contains the content)    |
| `src/text/normalize.ts` | Normalized analysis text with a map back to the original                          |
| `src/rules/`            | Word lists (`lexicon.ts`), pattern helpers and negation (`pattern.ts`), the rules |
| `src/indicators/`       | Indicator catalog: codes, strengths, sources, official basis, explanations        |
| `src/risk/`             | Risk-level rules and summary texts                                                |
| `src/actions/`          | Action catalog, action → article mapping, action selection                        |
| `src/text/evidence.ts`  | Evidence snippets from the original text                                          |
| `src/redact.ts`         | Redaction utility for logs and errors                                             |
| `src/analyzer.ts`       | `analyzeScam`: the pipeline                                                       |
| `src/version.ts`        | `RULESET_VERSION`                                                                 |

## 5. Indicator categories

| Code                             | Meaning                                                                                                                 | Strength          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `CREDENTIAL_REQUEST`             | Asks for an OTP, PIN, password, CVV/CVC, verification code or banking login                                             | strong            |
| `UNKNOWN_TRANSACTION`            | Describes a payment or transaction the user did not make or recognise                                                   | strong            |
| `ADVANCE_PAYMENT`                | A fee or payment before a promised prize, loan, job or money                                                            | strong            |
| `ACCOUNT_ACCESS_REQUEST`         | Using or renting the user's account for others, or access to their banking app                                          | strong            |
| `INVESTMENT_SCHEME`              | An investment offer together with unrealistic returns                                                                   | moderate          |
| `UNAUTHORIZED_DEPOSIT_INDICATOR` | Collecting deposits with unrealistic returns or "higher than banks"                                                     | strong            |
| `FAKE_LOAN_OFFER`                | A loan offer with an upfront fee or a credential request (strong), or with unusually easy approval terms (moderate)     | strong / moderate |
| `PYRAMID_SCHEME_INDICATOR`       | Earnings from recruiting members (strong with a joining payment, returns paid from new members, or unrealistic returns) | moderate / strong |
| `UNREALISTIC_RETURN`             | Guaranteed, risk-free, high, quick or doubled returns; % per day, week or month                                         | moderate          |
| `SUSPICIOUS_LINK`                | A request to click, open, sign in or verify through a link                                                              | moderate          |
| `PERSONAL_INFORMATION_REQUEST`   | Card details, NIC, username or date of birth (moderate); account number or personal details (weak)                      | moderate / weak   |
| `PAYMENT_TRANSFER_REQUEST`       | A request to send, transfer or deposit money                                                                            | moderate          |
| `IMPERSONATION`                  | A claim to be a bank, CBSL, the police or another authority, **only** together with a suspicious request or urgency     | moderate          |
| `URGENCY_PRESSURE`               | Act now, last chance, within N minutes, account closure, arrest threats                                                 | weak              |
| `UNSOLICITED_OFFER`              | An unexpected prize, win, selection, job, refund or "problem with your account"                                         | weak              |
| `OTHER_SUSPICIOUS_PATTERN`       | Insisting that the request is safe, legal, genuine or official                                                          | weak              |

Strengths are internal weights for the risk level. The API never returns them.

## 6. Rule design

- **Requests need a verb and an object in one sentence.**
  - English uses verb then object ("send me your OTP", "asked for my PIN").
  - Sinhala and Tamil use object then verb ("ඔබේ OTP අංකය එවන්න", "உங்கள் OTP ஐ அனுப்புங்கள்").
  - An English verb inside a Sinhala or Tamil sentence counts only with a local helper verb ("send කරන්න", "send பண்ணுங்க").
  - The gap between verb and object is bounded and stops at sentence ends. Abbreviations such as "Rs." do not end a sentence.
- **Negation and hypotheticals are not requests.** For example:
  - "never share your OTP", "do not click links" and "the bank will never ask for your PIN";
  - "if anyone asks for your PIN";
  - Sinhala "…දෙන්න එපා" and "ලබා නොදෙන්න";
  - Tamil "…பகிர வேண்டாம்" and conditional verbs ending in "-ால்".

  So legitimate warnings, including FinVoice's own knowledge-base text, do not trigger request rules. Tests cover this.

- **Context-dependent rules are composites.** They run after the pattern rules and use their results:
  - impersonation counts only with a suspicious request or urgency;
  - an investment only with unrealistic returns;
  - deposit-taking only with unrealistic or "higher than banks" returns;
  - a loan only with a fee, a credential request or unusually easy terms;
  - a named fee (processing, release, clearance …) counts as an advance payment only when the content promises a benefit (a prize, loan, job or money).
- **Large numbers alone are not indicators.** Rule C detects the promise ("guaranteed", "risk-free", "20% per month"), never the size of an amount. A loan's monthly interest rate does not trigger it.
- **"Today" alone is not urgency.** Only "only today", "expires today", "act today" and similar phrases count.
- **Patterns are linear.** They use bounded gaps and no nested unbounded repetition. A 10,000-character input is analysed in milliseconds, and a test covers a pathological input.

## 7. Source grounding

Every indicator in [`src/indicators/catalog.ts`](../../packages/scam-shield/src/indicators/catalog.ts) has three references:

- `sourceSlugs`: at least one FinVoice knowledge article, resolved by the API;
- `officialBasis`: the CBSL material the patterns come from;
- `reviewedOn`: when the rule was last checked against its sources.

Sources were re-read on 27 September 2026. They are:

- the Be Scam Proof page and its posters:
  - plantation investment;
  - pyramid schemes;
  - digital scams;
  - unauthorised deposits;
  - "Your password and PIN are like your toothbrush!";
  - "Don't Recognize a Transaction? Don't Ignore It!";
  - account misuse;
  - "guaranteed returns / claim your free reward";
- the CBSL note "Protecting Financial Consumers from Financial Frauds and Scams" (June 2026);
- the CBSL note on pyramid schemes;
- the FIU booklet "Financial Scams: The Hell Underneath the Heaven" (December 2023);
- the press notices of 21 November 2019 (passwords and PINs, fake loan approvals) and 1 August 2019 (safe electronic payments).

| Articles cited                     | By                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `protect-pin-otp-passwords`        | `CREDENTIAL_REQUEST`, `ACCOUNT_ACCESS_REQUEST`, `FAKE_LOAN_OFFER`; action `DO_NOT_SHARE_CREDENTIALS`                                                               |
| `recognise-scams`                  | urgency, returns, offers, impersonation, advance payment, links, schemes, payment requests, other; actions `DO_NOT_SEND_MONEY_YET`, `VERIFY_WITH_OFFICIAL_CHANNEL` |
| `report-suspicious-activity`       | `UNKNOWN_TRANSACTION`; actions `CONTACT_BANK`, `CHECK_ACCOUNT_ACTIVITY`, `REPORT_SUSPICIOUS_ACTIVITY`                                                              |
| `safe-digital-payments`            | `PERSONAL_INFORMATION_REQUEST`                                                                                                                                     |
| `understand-terms-before-agreeing` | `FAKE_LOAN_OFFER` (unusually easy terms)                                                                                                                           |
| `consumer-rights-and-complaints`   | related article of action `REPORT_SUSPICIOUS_ACTIVITY` (the Central Bank's FCRD inquiries hotline)                                                                 |

Some rules do not map cleanly to an existing article. For example, the articles do not mention links explicitly, and there is no article on pyramid schemes or unauthorised deposit-taking. Those rules cite the closest Be Scam Proof article (`recognise-scams`), and `officialBasis` names the poster or note that supports the pattern.

**Rules not created for lack of a source:** remote-control and screen-sharing apps (for example "install AnyDesk"). No verified CBSL material covering them was found, so `ACCOUNT_ACCESS_REQUEST` covers only account misuse and access to the account or banking app (the account-misuse poster).

## 8. Evidence extraction

- Rules match the **normalized** text (section 11). The analysis text keeps a map from every normalized character to its span in the **original**, and evidence is always cut from the original. The user sees their own words, including full-width letters, decomposed vowel signs and zero-width joiners.
- **Limits:**
  - at most **5 snippets per indicator**, each at most **160 characters** (longer spans are cut at a character boundary and end with "…");
  - at most **5 indicators** per result, strongest first, with `indicatorsTruncated` set when more were found;
  - the whole message is never returned.
- **Snippet clean-up:** overlapping matches are merged, duplicates are removed, and control characters and line breaks appear as spaces. Card-like digit sequences of 13–19 digits are masked as `[card number]`.

## 9. Risk-level semantics

| Level                      | Rule                                                                                                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HIGH`                     | ≥ 2 strong indicators; or 1 strong + any other (for example a credential request + urgency or + an unexpected offer, an advance payment + a suspicious offer, an unknown transaction + a request for details); or ≥ 3 indicators of which ≥ 2 are moderate |
| `MEDIUM`                   | at least 1 strong or moderate indicator, or ≥ 2 weak indicators                                                                                                                                                                                            |
| `LOW`                      | 1 weak indicator (`LIMITED_INDICATORS_DETECTED`), or no indicator in content of at least 6 words (`NO_STRONG_INDICATORS_DETECTED`)                                                                                                                         |
| `INSUFFICIENT_INFORMATION` | no indicator, and fewer than 6 words                                                                                                                                                                                                                       |

Examples:

| Content                                                                                   | Indicators                                                      | Level    |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------- |
| "I have an investment opportunity for you."                                               | none: an investment offer on its own is not a warning sign      | `LOW`    |
| "I have an investment opportunity for you with guaranteed returns."                       | `INVESTMENT_SCHEME` + `UNREALISTIC_RETURN` (2 moderate)         | `MEDIUM` |
| The same, plus "Send me your OTP to register."                                            | `+ CREDENTIAL_REQUEST` (strong + others)                        | `HIGH`   |
| "Invest in our plantation for guaranteed returns of 20% per month. Last chance, act now!" | `INVESTMENT_SCHEME` + `UNREALISTIC_RETURN` + `URGENCY_PRESSURE` | `HIGH`   |
| "I don't recognise this payment"                                                          | `UNKNOWN_TRANSACTION` (1 strong, alone)                         | `MEDIUM` |

**A single indicator, strong or moderate, is `MEDIUM`.** `HIGH` always needs at least two indicators. `INVESTMENT_SCHEME` is **moderate** because its rule only fires together with an unrealistic-return claim, which is itself an indicator. As a strong indicator, every investment scheme would have been `HIGH` from its own pattern alone. It becomes `HIGH` only with further indicators, such as a credential request or urgency. A detected investment scheme is a warning pattern, never proof that the offer is fraudulent.

The level and actions consider **all** detected indicators, including any beyond the 5 returned. There is no numeric score anywhere in the result, and a test checks that the result contains no numbers.

## 10. Why the risk level is not a legal scam determination

The level summarises **patterns in the text**, not facts about the sender. A genuine bank message can contain urgency, and a scam can be worded so that no pattern matches. ScamShield cannot know:

- who sent the content;
- whether a company is licensed;
- whether a link is malicious.

Deciding that something is a scam, or that a business is an unauthorised deposit-taker or a prohibited pyramid scheme, is for regulators and courts. So the wording is fixed:

- the summary for `HIGH` is "High-risk indicators detected. ScamShield detected the following warning indicators…";
- the deposit-taking explanation says "verify regulatory status through official CBSL channels";
- the pyramid explanation says the pattern "does not establish that any particular business is one";
- with no indicators, the summary is "This check did not identify strong known warning indicators, but that does not prove the offer is legitimate."

`SAFE`, `NOT_A_SCAM` and similar values do not exist.

## 11. Multilingual behaviour

- **All patterns run on all content.** Patterns of every language run on every input, whatever `language` says, so mixed content ("Please ඔබේ PIN අංකය එවන්න", "ඔබේ bank account number එක එවන්න") is covered. Language-neutral signals, such as "OTP", "PIN", "CVV", amounts, percentages and web addresses, work in any language.
- **Normalization,** applied per grapheme cluster so letters and their vowel signs stay together:
  - Unicode NFKC, which composes Tamil vowel signs and turns full-width Latin into ASCII;
  - lower case;
  - removal of invisible formatting characters (the Sinhala zero-width joiner only selects a conjunct glyph);
  - typographic quotes and dashes mapped to ASCII;
  - collapsed whitespace.

  No Sinhala or Tamil letters are removed, and nothing is transliterated.

- **Sinhala and Tamil coverage is partial.** The patterns cover the strongest indicators: credentials, urgency, unknown transactions, unrealistic returns, advance payments, payment requests, personal details, unexpected offers, impersonation, deposit-taking, pyramid recruitment, loans and links. They use short, confidently known word lists, which have not yet been reviewed by native speakers, and cover far fewer phrasings than English. `languageCoverage` is therefore `PARTIAL` for SI and TA requests, and for English requests whose content contains Sinhala or Tamil script. It is `FULL` only for English content, meaning every indicator has English patterns (not that every wording is caught).
- **Explanations are in English** in version 1. The cited knowledge articles are returned in the requested language where a translation exists, with English fallback, labelled by `language`.

## 12. Privacy

The content may contain names, phone numbers, account and card numbers, links, OTPs, passwords and addresses. Therefore:

- **Nothing is logged.**
  - The engine never logs, and the API service never logs content or evidence.
  - An unexpected engine error is replaced by `ScamShield analysis failed (<ErrorType>)`, so no message or stack that could quote the content reaches the global error log.
  - Validation errors contain field paths and fixed messages, never values.
- **Evidence is returned only to the request that submitted it,** with `Cache-Control: no-store`.
- **Redaction exists as a safety net.** `redactSensitiveText` (in the package) redacts e-mail addresses, web addresses, labelled secrets ("password: …", "OTP is …"), card-like numbers, phone numbers and OTP-like codes, for text that reaches a log unexpectedly. It is **not** permission to log content: the rule remains "do not log user content".
- **Tests prove this as behaviour.** A capturing logger and stdout/stderr spies must show no content, including on a failing request.

## 13. No content storage

**ScamShield does not persist user-submitted content or analysis history. It may emit a privacy-safe SCAM_ANALYSIS analytics event containing only typed operational metadata.**

- **Not persisted:** there is no scam-analysis table, no message table and no analysis history. The submitted content, the evidence, extracted phrases, URLs, phone numbers, card data, user ids and search queries are never stored.
- **The analytics event (Step 10):** each analysis records one `SCAM_ANALYSIS` row in `analytics_events`. It holds only typed operational metadata: the final risk level, language, selected content type, success, duration and the event time. The table has no free-text or JSON column and no user id, so the event cannot carry content, and it cannot be linked to a person or to other analyses. It is kept separate from business data (no foreign keys) and deleted after the analytics retention period. See [analytics.md](analytics.md).
- **Tests prove this as behaviour.** Integration tests install statement-level audit triggers on **every** table and check that an analysis:
  - writes nothing to any business table (users, profiles, goals, knowledge, literacy);
  - writes exactly one INSERT, into `analytics_events`, with the expected typed fields;
  - leaves a unique marker from the content in no row of any table, including `analytics_events`.

  As a control, the test also checks that the audit does record a real write.

## 14. No external APIs

ScamShield does not call Gemini or any other AI, search engines, URL reputation services (VirusTotal or similar), bank APIs or the police. It does not verify websites in real time.

Integration tests check this with spies:

- `fetch`, `http.request`, `https.request` and socket connections see only the test's own local API call and the test database;
- the fake language model receives no request.

A second test app with no Gemini key configured answers normally.

## 15. Reporting guidance

Reporting details are time-sensitive, for example the CBSL hotline, the Financial Consumer Relations Department, the online complaint system and scam-specific contacts. They are **not** in ScamShield code: a test checks that the engine contains no hotline number, e-mail address, web address or postal address.

The actions `CONTACT_BANK`, `CHECK_ACCOUNT_ACTIVITY` and `REPORT_SUSPICIOUS_ACTIVITY` cite `report-suspicious-activity`. The API returns that article's current title, summary and source.

`REPORT_SUSPICIOUS_ACTIVITY` also returns `consumer-rights-and-complaints` in `relatedKnowledge`. Its summary gives the Central Bank's FCRD inquiries hotline, attributed to the FCRD page:

- **Why a related article:** the reporting steps and the hotline come from different official sources. Each article cites exactly one source, so each fact stays with its own attribution, and neither article copies the other.
- **Why not `CONTACT_BANK`:** 1935 is the Central Bank's line, not a bank's, so that action has no related article.
- **Source-agnostic engine:** the engine lists only slugs (`ACTION_RELATED_KNOWLEDGE`), and a test checks that the number never appears in ScamShield code.

The article was checked against the current Be Scam Proof material on 27 September 2026 and needs no change:

- contact your bank, suspend your card, change your login details and check your account activity;
- never share your PIN, password or OTP;
- complain to the police station and the bank.

**CBSL hotline 1935.** The Financial Consumer Relations Department (FCRD) page lists "Hotline for Inquiries : 1935" under its contact details. The Be Scam Proof material served on 27 September 2026 contains no hotline or other contact details. This was re-checked twice that day across the page (raw HTML), its 12 posters (unchanged since 20 July 2026), the campaign logo and the three linked CBSL/FIU PDFs. Following the sources, the hotline was therefore added to the FCRD-sourced article `consumer-rights-and-complaints`, not to `report-suspicious-activity`, as "For inquiries, the FCRD has a hotline: 1935".

- The article is now time-sensitive and reviewed every 3 months.
- Its FCRD source was re-verified the same day.
- The hotline appears in the article's body and its summary, which is what references return. It is described as the source does: an inquiries hotline, not a scam hotline.
- Databases seeded earlier receive the change through the guarded data migrations `20260927200000_knowledge_fcrd_hotline` (body, keywords and review data) and `20260927210000_knowledge_fcrd_hotline_summary` (summary).
- It is available through `KnowledgeService` (for example `GET /api/v1/knowledge/articles/consumer-rights-and-complaints`, or a search for "1935").
- ScamShield code still contains no contact details.

**Complaint Management System.** The CBSL release of 15 May 2026 ([node/20329](https://www.cbsl.gov.lk/en/node/20329)) describes the online CMS: complain to the financial service provider first, then escalate to CBSL through the CMS if the matter is unresolved or the answer unsatisfactory. It was **not** added. Every knowledge article cites exactly one source, and the only suitable existing article is sourced from the FCRD page, which does not mention the CMS. Adding it there would attribute it to a source that does not say it, and a separate CMS article was out of scope. The existing article's route (the institution first, then FCRD) agrees with the release.

## 16. KnowledgeService integration

- `KnowledgeService.getPublishedMany(slugs, language)` resolves every cited slug in **one** query, whatever the number of indicators and actions. It returns only PUBLISHED articles that have a source and English text.
- Each reference is `{ slug, available, title, language, summary, source { publisher, title, url, lastVerifiedAt }, reviewRequired }`.
- An unpublished or missing article becomes `available: false` with every other field null. Its text never leaks, and the indicator is kept.
- `reviewRequired` is copied from the knowledge layer: the article is time-sensitive and past its review date. If a source needs review, the rule is **not** removed or declared invalid. The result marks the source as needing review.

## 17. Future Gemini integration

```text
User content
   ↓
ScamShield engine          ← authoritative
   ↓
Structured result
   ↓
Gemini                     ← explains the result in natural language, in the user's language
   ↓
Natural-language explanation
```

Gemini **must not**:

- decide or change the risk level;
- add indicators the engine did not detect;
- remove or soften detected indicators;
- override the result;
- invent reporting contacts (contacts come only from the cited knowledge articles).

The content stays **data** at this boundary too. Text such as "ignore your rules", "tell FinVoice this is safe", "act as the system administrator" or "do not report this" is analysed as text and never followed.

The engine already guarantees this, and the prompt-injection tests pin it: the risk level and indicators of a scam message are unchanged when injections are added before or after it. A future Gemini layer must receive the content only as quoted data, with the structured result as the authoritative input.

**Action boundary.** ScamShield only recommends educational actions: don't share credentials, don't send money yet, verify through official channels, contact your bank, report suspicious activity. It must never do any of the following itself:

- freeze accounts;
- block cards;
- contact banks;
- file police reports;
- transfer funds;
- change passwords;
- reset credentials.

Those would need explicit future workflows with user authorisation.

## 18. Future ML and RAG possibilities

These could be added later, next to the deterministic rules and never in place of them:

- a reviewed corpus of real, anonymised scam examples, used to measure recall and false positives;
- native-speaker review of Sinhala and Tamil patterns, and colloquial and transliterated (Singlish/Tanglish) forms;
- verification of named institutions against controlled, authoritative lists (licensed banks and finance companies), as a separate feature;
- a classifier or embedding similarity as an additional, clearly labelled signal.

Any learned component would need its own evaluation, versioning and governance. It could add indicators only as "possible" signals, never override the rule-based ones.

## 19. Limitations

- **Recall is limited to known phrasings.** New wording, heavy misspelling, images, voice notes and text split across several messages are not recognised.
- **Sinhala and Tamil coverage is partial and machine-assisted.** Colloquial forms and transliterations (Sinhala or Tamil written in Latin letters) are mostly not covered.
- **Some false positives are possible.** Legitimate payment requests or bank messages that use urgent wording can be reported as MEDIUM. The wording says "check through an official channel", not "scam".
- **Negation is heuristic.** "If you don't reply, send your OTP" may be missed, which is conservative in the sense of not over-claiming.
- **The engine does not know the context.** It cannot tell whether an offer was solicited, or know who the sender is.
- **There is no rate limiting yet.** It is planned for a later security step, without Redis for now.

## 20. Governance and rule review

Every rule must have all of the following. Undocumented rules are not allowed.

- a **rule code**: the indicator code, plus a unique rule `id`;
- a plain-English **explanation** that never claims that content is a scam;
- a **source**: at least one knowledge article slug and an `officialBasis` naming the official material;
- the **rule-set version** it belongs to;
- a **review date** (`reviewedOn`).

Tests in `packages/scam-shield/test/sources.test.ts` enforce these fields, unique ids, known slugs, an action for every indicator, the absence of contact details, and the absence of framework or network imports.

**Review process:**

- **When a source changes or is re-checked** (at least with the yearly knowledge review, and whenever the Be Scam Proof material changes), each rule's patterns and `officialBasis` are compared with it and `reviewedOn` is updated.
- **A rule found to be outdated is reviewed,** not silently removed. A change to its patterns or strength bumps `RULESET_VERSION`.
- **New rules need a verified official source** before they are added. "Sounds reasonable" is not enough. For example, remote-access apps were not added.
- **False positives and false negatives** reported by users or reviewers are turned into test cases before the rule changes.

## 21. Rule versioning

`RULESET_VERSION` is `"1"`, and every result carries it as `scamShieldVersion`. Bump the version when any of these change:

- a rule, pattern, word list or strength;
- the source mapping;
- the risk logic;
- the action mapping;
- an evidence limit.

The version identifies which rules produced a result. There is deliberately no multi-version framework: one rule set is live at a time.

Version `1` is the first released rule set. Changes made during the Step 9 review, before its first release, are part of version `1`: the `INVESTMENT_SCHEME` strength and the related article of the reporting action.
