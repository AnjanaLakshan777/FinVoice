/**
 * The controlled list of warning indicators. Every indicator names the FinVoice knowledge articles
 * that support it (`sourceSlugs`, resolved by the API through the knowledge base) and the official
 * CBSL material its patterns are based on (`officialBasis`, for review; not returned to users).
 *
 * Contact details (hotlines, e-mail addresses, web addresses, postal addresses) never appear here:
 * current reporting information lives in the knowledge base.
 */

export const INDICATOR_CODES = [
  "CREDENTIAL_REQUEST",
  "URGENCY_PRESSURE",
  "UNREALISTIC_RETURN",
  "UNSOLICITED_OFFER",
  "IMPERSONATION",
  "ADVANCE_PAYMENT",
  "UNKNOWN_TRANSACTION",
  "SUSPICIOUS_LINK",
  "PERSONAL_INFORMATION_REQUEST",
  "ACCOUNT_ACCESS_REQUEST",
  "INVESTMENT_SCHEME",
  "UNAUTHORIZED_DEPOSIT_INDICATOR",
  "PYRAMID_SCHEME_INDICATOR",
  "FAKE_LOAN_OFFER",
  "PAYMENT_TRANSFER_REQUEST",
  "OTHER_SUSPICIOUS_PATTERN",
] as const;
export type IndicatorCode = (typeof INDICATOR_CODES)[number];

/**
 * How much weight a detected indicator carries in the risk level (see risk/classify.ts). Internal:
 * the result shows indicators and a level, never weights or scores.
 * - STRONG: a well-known scam step on its own (asking for an OTP, an upfront fee, …).
 * - MODERATE: a meaningful warning sign that also has legitimate uses (a payment request, a link).
 * - WEAK: context that is common in scams but also in ordinary messages (urgency, a prize).
 */
export const INDICATOR_STRENGTHS = ["STRONG", "MODERATE", "WEAK"] as const;
export type IndicatorStrength = (typeof INDICATOR_STRENGTHS)[number];

/** FinVoice knowledge article slugs that ScamShield rules and actions cite. */
export const SCAM_SHIELD_SOURCE_SLUGS = [
  "recognise-scams",
  "protect-pin-otp-passwords",
  "report-suspicious-activity",
  "safe-digital-payments",
  "understand-terms-before-agreeing",
  "consumer-rights-and-complaints",
] as const;
export type ScamShieldSourceSlug = (typeof SCAM_SHIELD_SOURCE_SLUGS)[number];

export type IndicatorDefinition = {
  readonly code: IndicatorCode;
  /** Default strength; a rule match may carry a different one (for example a stronger variant). */
  readonly strength: IndicatorStrength;
  readonly sourceSlugs: readonly [ScamShieldSourceSlug, ...ScamShieldSourceSlug[]];
  /** The official material the patterns are based on (CBSL Be Scam Proof campaign and notices). */
  readonly officialBasis: string;
  /**
   * Plain-English explanation shown with the indicator. Never says that something IS a scam.
   * `{details}` is replaced with what was detected (for example "an OTP and a PIN").
   */
  readonly explanation: string;
  /** When the rule was last checked against its sources ("YYYY-MM-DD"). */
  readonly reviewedOn: string;
};

const REVIEWED_ON = "2026-09-27";

export const INDICATOR_DEFINITIONS: Readonly<Record<IndicatorCode, IndicatorDefinition>> = {
  CREDENTIAL_REQUEST: {
    code: "CREDENTIAL_REQUEST",
    strength: "STRONG",
    sourceSlugs: ["protect-pin-otp-passwords"],
    officialBasis:
      "CBSL press notice 'Beware of Online Scams - Protect Your Bank Passwords and PINs' (21 November 2019); Be Scam Proof posters 'Your password and PIN are like your toothbrush!' and the digital-scams poster (requests for username, password, PIN or OTP)",
    explanation:
      "The content asks for {details}. PINs, passwords, one-time passwords (OTPs) and card security codes should never be shared with anyone.",
    reviewedOn: REVIEWED_ON,
  },
  URGENCY_PRESSURE: {
    code: "URGENCY_PRESSURE",
    strength: "WEAK",
    sourceSlugs: ["recognise-scams"],
    officialBasis:
      "Be Scam Proof campaign and CBSL note 'Protecting Financial Consumers from Financial Frauds and Scams' (June 2026): scammers create fear and urgency and pressure people to act quickly; posters 'don't be pressured' and 'phishing often creates urgency'",
    explanation:
      "The content pressures you to act quickly or warns of a penalty, which leaves little time to check whether it is genuine.",
    reviewedOn: REVIEWED_ON,
  },
  UNREALISTIC_RETURN: {
    code: "UNREALISTIC_RETURN",
    strength: "MODERATE",
    sourceSlugs: ["recognise-scams"],
    officialBasis:
      "Be Scam Proof rule 'Question unrealistic returns'; posters on plantation investments (very high returns in a short time, returns even if crops fail), pyramid schemes (quick or guaranteed returns) and 'guaranteed returns, fast profits, risk free'",
    explanation:
      "The content promises returns that are guaranteed, risk-free or unusually fast. Question unrealistic returns before paying anything.",
    reviewedOn: REVIEWED_ON,
  },
  UNSOLICITED_OFFER: {
    code: "UNSOLICITED_OFFER",
    strength: "WEAK",
    sourceSlugs: ["recognise-scams"],
    officialBasis:
      "Be Scam Proof campaign (attractive promises, 'claim your free reward'); FIU booklet 'Financial Scams: The Hell Underneath the Heaven' (December 2023): lottery, prize and job scams",
    explanation:
      "The content announces an unexpected prize, reward, selection, job or offer. On its own this does not show a scam, but it is a common way for one to start.",
    reviewedOn: REVIEWED_ON,
  },
  IMPERSONATION: {
    code: "IMPERSONATION",
    strength: "MODERATE",
    sourceSlugs: ["recognise-scams"],
    officialBasis:
      "Be Scam Proof campaign (pretending to be someone you trust); CBSL note (June 2026) on impersonation; credentials poster (do not trust a request because the requester says they are official)",
    explanation:
      "The sender claims to represent a bank, authority or other official body and also makes a suspicious request. A claim to be official does not make a request safe.",
    reviewedOn: REVIEWED_ON,
  },
  ADVANCE_PAYMENT: {
    code: "ADVANCE_PAYMENT",
    strength: "STRONG",
    sourceSlugs: ["recognise-scams"],
    officialBasis:
      "FIU booklet on the Be Scam Proof page (December 2023): lottery and job scams ask for deposits or advance payments to release a prize or job; CBSL fake-loan warning (fees during a fake approval)",
    explanation:
      "The content asks for a fee or payment before you receive a promised prize, loan, job or other money.",
    reviewedOn: REVIEWED_ON,
  },
  UNKNOWN_TRANSACTION: {
    code: "UNKNOWN_TRANSACTION",
    strength: "STRONG",
    sourceSlugs: ["report-suspicious-activity"],
    officialBasis:
      "Be Scam Proof poster 'Don't Recognize a Transaction? Don't Ignore It!' (contact your bank, suspend your card, change your login details, check your account activity)",
    explanation:
      "The content describes a payment or transaction that was not recognised or not made by the account holder. This needs attention straight away.",
    reviewedOn: REVIEWED_ON,
  },
  SUSPICIOUS_LINK: {
    code: "SUSPICIOUS_LINK",
    strength: "MODERATE",
    sourceSlugs: ["recognise-scams"],
    officialBasis:
      "Be Scam Proof digital-scams poster (suspicious links or files; use only official websites and apps); FIU booklet ('do not click unknown links')",
    explanation:
      "Contains a request to use a link; verify through the institution's official website/app instead.",
    reviewedOn: REVIEWED_ON,
  },
  PERSONAL_INFORMATION_REQUEST: {
    code: "PERSONAL_INFORMATION_REQUEST",
    strength: "MODERATE",
    sourceSlugs: ["safe-digital-payments"],
    officialBasis:
      "CBSL press notice 'Adopting Safe and Secure Electronic Payment Practices' (1 August 2019): account numbers, card details and NIC number; Be Scam Proof digital-scams poster (requests for account number or NIC)",
    explanation: "The content asks for confidential financial or identity details ({details}).",
    reviewedOn: REVIEWED_ON,
  },
  ACCOUNT_ACCESS_REQUEST: {
    code: "ACCOUNT_ACCESS_REQUEST",
    strength: "STRONG",
    sourceSlugs: ["protect-pin-otp-passwords", "recognise-scams"],
    officialBasis:
      "Be Scam Proof poster on account misuse (letting others use your account for their deposits or transfers, for a commission); CBSL press notice 2019 (credentials are for the account owner only). Remote-control apps are not covered: no verified source was found for them",
    explanation:
      "The content asks to use or get into your bank account or banking app, for example to receive or move money for someone else.",
    reviewedOn: REVIEWED_ON,
  },
  INVESTMENT_SCHEME: {
    code: "INVESTMENT_SCHEME",
    // MODERATE: the rule requires an unrealistic-return claim, which is always a second indicator.
    // As STRONG, every investment scheme would be HIGH on its own pattern; as MODERATE it is MEDIUM
    // (with its return claim) and HIGH only with further indicators such as a credential request.
    strength: "MODERATE",
    sourceSlugs: ["recognise-scams"],
    officialBasis:
      "Be Scam Proof campaign (fake investment schemes; plantation-investment poster); CBSL note (June 2026): verify an investment before transferring money",
    explanation:
      "The content offers an investment together with unrealistic return claims. Check the offer through official channels before you invest.",
    reviewedOn: REVIEWED_ON,
  },
  UNAUTHORIZED_DEPOSIT_INDICATOR: {
    code: "UNAUTHORIZED_DEPOSIT_INDICATOR",
    strength: "STRONG",
    sourceSlugs: ["recognise-scams"],
    officialBasis:
      "Be Scam Proof poster on unauthorised deposit-taking (is it licensed or authorised to take deposits? high returns fast; pressure to deposit immediately)",
    explanation:
      "Higher-risk indicator: the offer appears to involve collecting money as a deposit or investment. Verify regulatory status through official CBSL channels before paying.",
    reviewedOn: REVIEWED_ON,
  },
  PYRAMID_SCHEME_INDICATOR: {
    code: "PYRAMID_SCHEME_INDICATOR",
    strength: "MODERATE",
    sourceSlugs: ["recognise-scams"],
    officialBasis:
      "Be Scam Proof pyramid-scheme poster (recruit to earn; returns depend on new members) and CBSL note on pyramid schemes",
    explanation:
      "The content links earnings to recruiting new members rather than to selling a real product or service. This is a known pyramid-scheme pattern; it does not establish that any particular business is one.",
    reviewedOn: REVIEWED_ON,
  },
  FAKE_LOAN_OFFER: {
    code: "FAKE_LOAN_OFFER",
    strength: "STRONG",
    sourceSlugs: ["protect-pin-otp-passwords", "understand-terms-before-agreeing"],
    officialBasis:
      "CBSL press notice (21 November 2019): fraudsters offer easy loans and ask for credentials during a fake approval process; FIU booklet (advance payments)",
    explanation: "The content combines a loan offer with {details}.",
    reviewedOn: REVIEWED_ON,
  },
  PAYMENT_TRANSFER_REQUEST: {
    code: "PAYMENT_TRANSFER_REQUEST",
    strength: "MODERATE",
    sourceSlugs: ["recognise-scams"],
    officialBasis:
      "CBSL note (June 2026): pressure to transfer funds; Be Scam Proof digital-scams poster (paying an unknown account); FIU booklet ('do not make payments to unseen people')",
    explanation:
      "The content asks you to send, transfer or deposit money. Check who you are paying through an official channel first.",
    reviewedOn: REVIEWED_ON,
  },
  OTHER_SUSPICIOUS_PATTERN: {
    code: "OTHER_SUSPICIOUS_PATTERN",
    strength: "WEAK",
    sourceSlugs: ["recognise-scams"],
    officialBasis:
      "Be Scam Proof credentials poster (do not trust a request because you are told it is safe or official)",
    explanation:
      "The content insists that it is safe, genuine or official. Being told something is safe does not make it safe.",
    reviewedOn: REVIEWED_ON,
  },
};
