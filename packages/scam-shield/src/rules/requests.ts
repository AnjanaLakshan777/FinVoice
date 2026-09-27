/**
 * Requests to disclose or hand over something: credentials (Rule A), confidential financial or
 * identity details (Rule I), money (payment or transfer requests) and use of the account itself
 * (Rule J). A request needs a request verb and its object in the same sentence; negated or
 * hypothetical wording ("never share your OTP", "if anyone asks for your PIN") is not a request.
 */
import { EN_REQUEST_VERBS, SI_REQUEST_VERBS, TA_REQUEST_VERBS } from "./lexicon.js";
import { anyOf, compile, gap, mixedVerb, patternRule, stem, word, type Rule } from "./pattern.js";

// ---------------------------------------------------------------------------------------------
// Rule A: credentials
// ---------------------------------------------------------------------------------------------

const EN_CREDENTIALS = word(
  anyOf(
    "otp|o\\.t\\.p|o t p|one[- ]time (?:password|pin|passcode|code)s?",
    "pins?(?: (?:number|code))?",
    "(?:(?:online|internet|mobile|net)[- ]?banking |bank(?:ing)? |account |login |email )?passwords?|passcodes?|passwd",
    "cvv2?|cvc2?|card security code|security code|verification code|(?:sms|6[- ]digit|4[- ]digit|confirmation) code",
    "code (?:we|i) sent|code (?:sent|received) (?:to|on) (?:your|my) (?:phone|mobile)",
    "login (?:details|credentials)|(?:online|internet|mobile)[- ]?banking (?:details|credentials|login)|credentials|user ?name and password",
  ),
);

/** Sinhala: password, secret number, PIN number, OTP (transliterated), verification/security code. */
const SI_CREDENTIALS = stem("මුරපද|රහස් අංක|පින් අංක|ඕටීපී|තහවුරු කිරීමේ කේත|ආරක්ෂක කේත");

/** Tamil: password (also in "one-time password"), secret number, PIN number, verification/security code. */
const TA_CREDENTIALS = stem(
  "ஒருமுறை கடவுச்சொ|கடவுச்சொ|இரகசிய எண்|ரகசிய எண்|பின் எண்|சரிபார்ப்புக் குறியீ|சரிபார்ப்பு குறியீ|பாதுகாப்புக் குறியீ|பாதுகாப்பு குறியீ",
);

const ALL_CREDENTIALS = anyOf(EN_CREDENTIALS, SI_CREDENTIALS, TA_CREDENTIALS);

function credentialDetail(matched: string): string {
  if (/otp|o\.t\.p|o t p|one[- ]time|ඕටීපී|ஒருமுறை/u.test(matched)) {
    return "an OTP";
  }
  if (/cvv|cvc|card security|ආරක්ෂක කේත|பாதுகாப்பு/u.test(matched)) {
    return "card security details (CVV/CVC)";
  }
  if (/code|කේත|குறியீ/u.test(matched)) {
    return "a verification code";
  }
  if (/\bpins?\b|රහස් අංක|පින් අංක|ரகசிய எண்|பின் எண்/u.test(matched)) {
    return "a PIN";
  }
  if (/login|credentials|user ?name|banking (?:details|login)/u.test(matched)) {
    return "online banking login details";
  }
  return "a password";
}

export const CREDENTIAL_RULES: readonly Rule[] = [
  patternRule({
    id: "CREDENTIAL_REQUEST.en",
    indicator: "CREDENTIAL_REQUEST",
    languages: ["EN"],
    description:
      "A request verb (send, share, give, tell, confirm, ask for, what is …) followed in the same sentence by an OTP, PIN, password, CVV/CVC, verification code or banking login.",
    patterns: [compile(`${EN_REQUEST_VERBS}${gap(40)}(?:${ALL_CREDENTIALS})`)],
    options: { negatable: true, detail: credentialDetail },
  }),
  patternRule({
    id: "CREDENTIAL_REQUEST.si-ta",
    indicator: "CREDENTIAL_REQUEST",
    languages: ["SI", "TA"],
    description:
      "An OTP, PIN, password or code (in English, Sinhala or Tamil) followed by a Sinhala or Tamil verb of sending, giving, telling, sharing or asking.",
    patterns: [
      compile(`(?:${ALL_CREDENTIALS})${gap(50)}(?:${SI_REQUEST_VERBS}|${TA_REQUEST_VERBS})`),
    ],
    options: { negatable: true, detail: credentialDetail },
  }),
];

// ---------------------------------------------------------------------------------------------
// Rule I: confidential financial or identity details
// ---------------------------------------------------------------------------------------------

/** Card and identity details: MODERATE on their own. */
const EN_SENSITIVE_DETAILS = word(
  anyOf(
    "(?:credit |debit |atm |bank )?card (?:number|no\\.?|details|information|info)|card's number|expiry(?: date)?|expiration date",
    "nic(?: number| no\\.?)?|national id(?:entity)?(?: card)?(?: number)?|id (?:card )?number|identity card(?: number)?|passport(?: number)?",
    "(?:banking |online banking |internet banking )?user ?name|login id|user id|date of birth|mother's maiden name",
  ),
);

/** Account numbers and general details: shared for ordinary reasons too, so WEAK on their own. */
const EN_GENERAL_DETAILS = word(
  anyOf(
    "(?:bank )?account (?:number|no\\.?|details)|acc(?:ount)? no\\.?|a\\/c (?:number|no\\.?)",
    "bank (?:details|information|info)|personal (?:details|information|info|data)",
  ),
);

/** Sinhala: card number/details, national identity card, identity card number, username, date of birth. */
const SI_SENSITIVE_DETAILS = stem(
  "කාඩ්පත් අංක|කාඩ් අංක|කාඩ්පත් විස්තර|ජාතික හැඳුනුම්පත|හැඳුනුම්පත් අංක|හැඳුනුම්පත|පරිශීලක නාම|උපන් දිනය",
);
/** Sinhala: account number/details, bank details, personal information/details. */
const SI_GENERAL_DETAILS = stem(
  "ගිණුම් අංක|ගිණුම් විස්තර|බැංකු විස්තර|පුද්ගලික තොරතුරු|පුද්ගලික විස්තර",
);
/** Tamil: card number/details, (national) identity card, username, date of birth. */
const TA_SENSITIVE_DETAILS = stem(
  "அட்டை எண்|அட்டை இலக்க|அட்டை விவர|தேசிய அடையாள|அடையாள அட்டை|பயனர் பெயர்|பயனர்பெயர்|பிறந்த திகதி|பிறந்த தேதி",
);
/** Tamil: account number/details, bank details, personal information/details. */
const TA_GENERAL_DETAILS = stem(
  "கணக்கு எண்|கணக்கு இலக்க|கணக்கு விவர|வங்கி விவர|வங்கிக் கணக்கு விவர|தனிப்பட்ட தகவல்|தனிப்பட்ட விவர",
);

const SENSITIVE_DETAILS = anyOf(EN_SENSITIVE_DETAILS, SI_SENSITIVE_DETAILS, TA_SENSITIVE_DETAILS);
const GENERAL_DETAILS = anyOf(EN_GENERAL_DETAILS, SI_GENERAL_DETAILS, TA_GENERAL_DETAILS);
const SI_TA_VERBS = `(?:${SI_REQUEST_VERBS}|${TA_REQUEST_VERBS})`;

function detailsDetail(matched: string): string {
  if (/card|expir|කාඩ්|அட்டை எண்|அட்டை இலக்க|அட்டை விவர/u.test(matched)) {
    return "card details";
  }
  if (/nic|national|identity|id (?:card )?number|passport|හැඳුනුම්|அடையாள/u.test(matched)) {
    return "an identity card number";
  }
  if (/user|login id|පරිශීලක|பயனர்/u.test(matched)) {
    return "a banking username";
  }
  if (/account|acc|a\/c|ගිණුම්|கணக்கு/u.test(matched)) {
    return "an account number";
  }
  return "personal details";
}

export const PERSONAL_INFORMATION_RULES: readonly Rule[] = [
  patternRule({
    id: "PERSONAL_INFORMATION_REQUEST.en.sensitive",
    indicator: "PERSONAL_INFORMATION_REQUEST",
    languages: ["EN"],
    description:
      "A request verb followed by card details, an NIC or other identity number, a banking username or date of birth.",
    patterns: [compile(`${EN_REQUEST_VERBS}${gap(40)}(?:${SENSITIVE_DETAILS})`)],
    options: { negatable: true, strength: "MODERATE", detail: detailsDetail },
  }),
  patternRule({
    id: "PERSONAL_INFORMATION_REQUEST.si-ta.sensitive",
    indicator: "PERSONAL_INFORMATION_REQUEST",
    languages: ["SI", "TA"],
    description:
      "Card details, identity card number or username (Sinhala, Tamil or English) followed by a Sinhala or Tamil request verb.",
    patterns: [compile(`(?:${SENSITIVE_DETAILS})${gap(50)}${SI_TA_VERBS}`)],
    options: { negatable: true, strength: "MODERATE", detail: detailsDetail },
  }),
  patternRule({
    id: "PERSONAL_INFORMATION_REQUEST.en.general",
    indicator: "PERSONAL_INFORMATION_REQUEST",
    languages: ["EN"],
    description:
      "A request verb followed by an account number, bank details or personal details (weak on its own: often shared for ordinary reasons).",
    patterns: [compile(`${EN_REQUEST_VERBS}${gap(40)}(?:${GENERAL_DETAILS})`)],
    options: { negatable: true, strength: "WEAK", detail: detailsDetail },
  }),
  patternRule({
    id: "PERSONAL_INFORMATION_REQUEST.si-ta.general",
    indicator: "PERSONAL_INFORMATION_REQUEST",
    languages: ["SI", "TA"],
    description:
      "An account number, bank details or personal details followed by a Sinhala or Tamil request verb (weak on its own).",
    patterns: [compile(`(?:${GENERAL_DETAILS})${gap(50)}${SI_TA_VERBS}`)],
    options: { negatable: true, strength: "WEAK", detail: detailsDetail },
  }),
];

// ---------------------------------------------------------------------------------------------
// Payment or transfer requests
// ---------------------------------------------------------------------------------------------

const EN_PAYMENT_VERBS = word(
  anyOf(
    "(?:send|transfer|deposit|pay|remit|wire|reload|top ?up)(?:s|ed|red|ing|ring)?|sent|paid",
    "ask(?:s|ed|ing)? (?:me |us |you )?for",
  ),
);

const AMOUNT = anyOf(
  "rs\\.? ?\\d[\\d,]*|lkr ?\\d[\\d,]*|\\d[\\d,]*(?:\\.\\d+)? ?(?:rs|rupees|lkr|\\/=)",
  "රු\\.? ?\\d[\\d,]*|\\d[\\d,]* ?(?:රු|රුපියල්)",
  "ரூ\\.? ?\\d[\\d,]*|\\d[\\d,]* ?(?:ரூபா|ரூ)",
);

const EN_PAYMENT_OBJECTS = anyOf(
  word("money|funds|cash|(?:the |an |this )?amount|(?:a |the )?payment|a deposit|rupees"),
  AMOUNT,
  word(
    "(?:to|into|in) (?:this|that|the following|the below|below|my|our|his|her|their|given|the given|a new|another) (?:bank )?(?:account|acc|a\\/c|number)",
  ),
);

/** Sinhala: money, rupees, an amount, "to the account", "to the number". */
const SI_PAYMENT_OBJECTS = anyOf(stem("මුදල්|රුපියල්|ගිණුමට|අංකයට"), AMOUNT);
/** Sinhala: send, pay, put in, deposit (imperative and past), plus mixed English verbs. */
const SI_PAYMENT_VERBS = anyOf(
  stem(
    "එවන්න|යවන්න|ගෙවන්න|දමන්න|දාන්න|තැන්පත් කරන්න|තැන්පත් කළ|ගෙව්වා|යැව්වා|එව්වා|දැම්මා|ට්රාන්ස්ෆර්",
  ),
  mixedVerb("transfer|deposit|send|pay"),
);
/** Tamil: money, rupees, an amount, "to the account". */
const TA_PAYMENT_OBJECTS = anyOf(stem("பணம்|பணத்தை|ரூபா|கணக்கிற்கு|கணக்குக்கு"), AMOUNT);
/** Tamil: send, pay, deposit, transfer, plus mixed English verbs. */
const TA_PAYMENT_VERBS = anyOf(
  stem("அனுப்ப|செலுத்த|வைப்பிலிட|வைப்புச் செய்|டெபாசிட்|மாற்று|மாற்றவும்"),
  mixedVerb("transfer|deposit|send|pay"),
);

export const PAYMENT_RULES: readonly Rule[] = [
  patternRule({
    id: "PAYMENT_TRANSFER_REQUEST.en",
    indicator: "PAYMENT_TRANSFER_REQUEST",
    languages: ["EN"],
    description:
      "A payment verb (send, transfer, deposit, pay …) followed by money, an amount or a destination account.",
    patterns: [compile(`${EN_PAYMENT_VERBS}${gap(40)}(?:${EN_PAYMENT_OBJECTS})`)],
    options: { negatable: true },
  }),
  patternRule({
    id: "PAYMENT_TRANSFER_REQUEST.si",
    indicator: "PAYMENT_TRANSFER_REQUEST",
    languages: ["SI"],
    description:
      "Money, an amount or an account followed by a Sinhala verb of sending, paying or depositing.",
    patterns: [compile(`(?:${SI_PAYMENT_OBJECTS})${gap(40)}(?:${SI_PAYMENT_VERBS})`)],
    options: { negatable: true },
  }),
  patternRule({
    id: "PAYMENT_TRANSFER_REQUEST.ta",
    indicator: "PAYMENT_TRANSFER_REQUEST",
    languages: ["TA"],
    description:
      "Money, an amount or an account followed by a Tamil verb of sending, paying or depositing.",
    patterns: [compile(`(?:${TA_PAYMENT_OBJECTS})${gap(40)}(?:${TA_PAYMENT_VERBS})`)],
    options: { negatable: true },
  }),
];

// ---------------------------------------------------------------------------------------------
// Rule J: use of or access to the account (account misuse, access to banking apps)
// ---------------------------------------------------------------------------------------------

const EN_ACCOUNT_ACCESS = anyOf(
  word(
    "(?:use|using|rent|borrow|lend|share|open) (?:of )?(?:your|my) (?:bank )?account (?:for|to (?:receive|deposit|transfer|send|get)|so (?:that )?(?:i|we|they|he|she) can)",
  ),
  word(
    "(?:let|allow)(?:s|ed|ing)? (?:me|us|them|him|her|someone|others|strangers) (?:to )?use (?:your|my) (?:bank )?account",
  ),
  word(
    "(?:receive|accept|collect) (?:money|funds|payments?|deposits?|transfers?) (?:in|into|to|through|on|via) (?:your|my) (?:bank )?account for (?:me|us|them|him|her|someone|others|a friend|strangers|the company|a commission)",
  ),
  word(
    "(?:give|provide|share|grant|allow|need|want|ask(?:ed|s)? for) (?:me |us |him |her |them )?(?:remote )?(?:access|log ?in) to (?:your|my) (?:bank(?:ing)? )?(?:account|app|online banking|internet banking|mobile banking)",
  ),
  word("(?:rent|hire) (?:out )?(?:your|my) (?:bank )?account|account (?:rental|for rent|on rent)"),
);

/** Sinhala: "account for rent", and "let (someone) use the account". */
const SI_ACCOUNT_ACCESS = anyOf(
  `${stem("ගිණුම")}${gap(10)}${stem("කුලියට")}`,
  `${stem("ගිණුම")}${gap(20)}${stem("භාවිත|භාවිතා|පාවිච්චි")}${gap(15)}${stem("දෙන්න|දෙනවා|දුන්නා|දීම")}`,
);

/** Tamil: "account for rent", and "give/allow (someone) to use the account". */
const TA_ACCOUNT_ACCESS = anyOf(
  `${stem("கணக்கை|கணக்கு")}${gap(10)}${stem("வாடகைக்கு")}`,
  `${stem("கணக்கை")}${gap(20)}${stem("பயன்படுத்த")}${gap(15)}${stem("கொடு|அனுமதி|தாருங்க")}`,
);

export const ACCOUNT_ACCESS_RULES: readonly Rule[] = [
  patternRule({
    id: "ACCOUNT_ACCESS_REQUEST.en",
    indicator: "ACCOUNT_ACCESS_REQUEST",
    languages: ["EN"],
    description:
      "Requests to use, rent or receive money through someone's bank account for others, or to be given access to their account or banking app.",
    patterns: [compile(EN_ACCOUNT_ACCESS)],
    options: { negatable: true },
  }),
  patternRule({
    id: "ACCOUNT_ACCESS_REQUEST.si-ta",
    indicator: "ACCOUNT_ACCESS_REQUEST",
    languages: ["SI", "TA"],
    description: "Sinhala and Tamil wording for renting out an account or letting others use it.",
    patterns: [compile(anyOf(SI_ACCOUNT_ACCESS, TA_ACCOUNT_ACCESS))],
    options: { negatable: true },
  }),
];
