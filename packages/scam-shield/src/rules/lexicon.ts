/**
 * Shared word lists. English terms are matched as whole words; Sinhala and Tamil terms as word
 * starts (see pattern.ts). Sinhala is written without zero-width joiners (they are removed before
 * matching). The Sinhala and Tamil lists are deliberately short: only common, confidently known
 * forms are included, and coverage is reported as PARTIAL for those languages.
 */
import { anyOf, mixedVerb, stem, word } from "./pattern.js";

/**
 * English verbs that ask for something to be disclosed ("send me your OTP", "asked for my PIN").
 * Past forms of disclosing verbs ("an OTP sent to your phone") describe events, not requests, so
 * only the asking verbs have past forms here.
 */
export const EN_REQUEST_VERBS = word(
  anyOf(
    "ask(?:s|ed|ing)?|request(?:s|ed|ing)?|want(?:s|ed)?|need(?:s|ed)?|demand(?:s|ed|ing)?",
    "send|sending|share|sharing|give|giving|tell|telling|provide|providing",
    "confirm|confirmed|confirming|read out|reveal|disclose|forward|reply with|say|mention|verify",
    "what is|what's|whats",
  ),
);

/**
 * Sinhala verbs of sending, giving, telling, sharing and asking (imperative, present and past
 * forms), plus English verbs commonly mixed into Sinhala sentences. Sinhala puts the verb last:
 * "ඔබේ OTP එක එවන්න" (send your OTP).
 */
export const SI_REQUEST_VERBS = anyOf(
  stem(
    "එවන්න|එවනවා|එව්වා|එවපු|එවලා|යවන්න|යවනවා|යැව්වා|දෙන්න|දෙනවා|දුන්නා|දීලා|කියන්න|කියනවා|කිව්වා|ඉල්ලුවා|ඉල්ලනවා|ඉල්ලා|ඉල්ලීම|ඉල්ලන|ඇහුවා|ඇසුවා|අහනවා|බෙදාගන්න|බෙදා ගන්න|සඳහන් කරන්න",
  ),
  mixedVerb("send|share|give|tell"),
);

/**
 * Tamil verbs of sending, giving, telling, sharing, asking and providing (stems; suffixes vary),
 * plus English verbs mixed into Tamil sentences. Tamil also puts the verb last.
 */
export const TA_REQUEST_VERBS = anyOf(
  stem(
    "அனுப்ப|அனுப்பு|கொடு|கொடுக்க|கொடுத்த|தாருங்க|தரவும்|தந்து|சொல்லு|சொல்லுங்க|சொல்லவும்|கூறு|கூறவும்|பகிர|பகிர்|கேட்ட|கேட்கிற|கேட்கின்ற|கேட்பார்|வழங்கு|வழங்க",
  ),
  mixedVerb("send|share|give|tell"),
);

/** Words that refer to a loan (not to a credit card). */
export const LOAN_TERMS = anyOf(
  word(
    "loans?|lending|lender|credit facility|micro ?finance|micro ?credit|(?:personal|instant|quick|easy|online|cash) credit",
  ),
  // Sinhala: loan (ණය, ණයක්, ණයට ...).
  stem("ණය"),
  // Tamil: loan (கடன், கடனை, கடனுக்கு ...), but not "credit card" (கடன் அட்டை).
  `${stem("கடன")}(?!் அட்டை)`,
);

/** A web address: with a scheme or "www.", or a bare host with a common top-level domain. */
export const URL_SOURCE = anyOf(
  "(?:https?:\\/\\/|www\\.)[^\\s<>\"']+",
  "(?<![\\p{L}\\p{N}@.\\/-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:com|net|org|lk|info|xyz|top|ly|link|site|online|club|app|io|me|co|biz|live|shop|store|click|gl|cc|at|in|us|to|id)(?:\\/[^\\s<>\"']*)?(?![\\p{L}\\p{N}])",
);
