# @finvoice/scam-shield

A deterministic, source-grounded engine that checks user-supplied content for **scam warning indicators**. It is pure, synchronous TypeScript with no runtime dependencies: no NestJS, Prisma, database, Google SDK, network, storage or logging. It does not use AI.

```ts
import { analyzeScam } from "@finvoice/scam-shield";

analyzeScam({
  content: "Your account will be closed. Send us your OTP now.",
  language: "EN",
  sourceType: "MESSAGE",
});
// → { scamShieldVersion: "1", assessmentType: "indicator_based", riskLevel: "HIGH",
//     summaryCode: "MULTIPLE_HIGH_RISK_INDICATORS", languageCoverage: "FULL",
//     indicators: [{ code: "CREDENTIAL_REQUEST", evidence: [{ type: "phrase", text: "Send us your OTP" }],
//                    sources: [{ slug: "protect-pin-otp-passwords" }], … },
//                  { code: "URGENCY_PRESSURE", … }],
//     actions: [{ code: "DO_NOT_SHARE_CREDENTIALS", priority: "RECOMMENDED",
//                 knowledgeSlug: "protect-pin-otp-passwords" }, …] }
```

- **Indicator-based:** the result is a level (`INSUFFICIENT_INFORMATION`, `LOW`, `MEDIUM`, `HIGH`) plus explicit indicators with evidence. It has no numeric score, it is not a legal determination, and it never says that content is "safe".
- **Content is data:** instructions inside the content are analysed as text and never followed.
- **Source-backed:**
  - Every indicator cites FinVoice knowledge-article slugs and the official CBSL material its patterns come from (`INDICATOR_DEFINITIONS`).
  - Actions map to article slugs (`ACTION_KNOWLEDGE`).
  - The API resolves slugs through the knowledge base. No contact details are in this package.
- **Evidence:** excerpts of the original content, at most 5 per indicator and 160 characters each. At most 5 indicators are returned.
- **Languages:** English (`FULL`); Sinhala and Tamil (`PARTIAL`: fewer phrasings). Mixed-language content is analysed with all patterns.
- **Validation:** invalid input throws `ScamShieldInputError`. Its issues never contain the content. Unknown properties are rejected.
- **Redaction:** `redactSensitiveText` is a safety net for logs and errors. It is not permission to log content.
- **Versioning:** results carry `scamShieldVersion` (`RULESET_VERSION`).

Design, rules, sources, privacy and governance: [docs/architecture/scam-shield.md](../../docs/architecture/scam-shield.md).
