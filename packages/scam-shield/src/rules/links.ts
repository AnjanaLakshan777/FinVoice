/**
 * Rule H: requests to use a link. ScamShield has no reputation service and never claims that a web
 * address is malicious: it reports that the content asks the user to use a link, and advises using
 * the institution's official website or app instead.
 *
 * Structural signals of a web address (a link shortener that hides the destination, a numeric IP
 * address instead of a name, an encoded "punycode" name that can imitate another name) are only
 * additional evidence: with a link request they are added to it; without one, a link that carries
 * such a signal is a WEAK indicator on its own.
 */
import { URL_SOURCE } from "./lexicon.js";
import {
  anyOf,
  compile,
  gap,
  isNegated,
  mixedVerb,
  scan,
  stem,
  word,
  type Rule,
  type RuleMatch,
} from "./pattern.js";

const LINK_NOUNS = anyOf(word("link|links|url|hyperlink"), stem("ලින්ක්|සබැඳි|இணைப்ப|லிங்க்"));

const EN_LINK_REQUEST = anyOf(
  // "click the link", "tap here", "open this URL".
  word(
    "(?:click|tap|press|open|visit|follow|go to|use) (?:on )?(?:the |this |that |a |my |our |given |following |below )?(?:link|url|hyperlink|here|button below)",
  ),
  // "verify your account through this link", "log in using the link below".
  `${word("log ?in|sign ?in|login|verify|update|confirm|unlock|reactivate|activate|claim|register|access|pay")}${gap(40)}${word("(?:through|via|using|on|at|with|by clicking|from) (?:the |this |that |our |a |following |below |given )?(?:link|url|hyperlink|website below|page below)")}`,
  // "the link below" after a request word.
  word(
    "(?:click|tap|open|visit|use|follow) (?:the )?(?:link|url) (?:below|above|sent|provided|given)",
  ),
);

/** A link-action verb in any of the three languages, followed closely by a web address. */
const ACTION_THEN_URL = `${anyOf(
  word(
    "click|tap|open|visit|go to|log ?in(?: at)?|sign ?in(?: at)?|login(?: at)?|verify(?: at)?|register(?: at)?|follow|check",
  ),
  stem("ක්ලික්|ඔබන්න|පිවිසෙන්න|கிளிக்|அழுத்த|பார்வையிட"),
)}${gap(20)}(?:${URL_SOURCE})`;

/**
 * A link word or web address followed by a click/press/open/visit verb (Sinhala and Tamil order,
 * also with English verbs mixed in): "මෙම ලින්ක් එක ක්ලික් කරන්න", "இந்த இணைப்பைக் கிளிக் செய்யவும்".
 */
const LINK_THEN_ACTION = `(?:${LINK_NOUNS}|${URL_SOURCE})${gap(40)}${anyOf(
  mixedVerb("click|tap|open|visit"),
  stem("ක්ලික්|ඔබන්න|විවෘත කරන්න|පිවිසෙන්න|கிளிக்|அழுத்த|திறக்க|திறந்து|பார்வையிட"),
)}`;

const LINK_REQUEST_PATTERNS = [EN_LINK_REQUEST, ACTION_THEN_URL, LINK_THEN_ACTION].map(compile);
const URL_PATTERN = compile(URL_SOURCE);

/** Host names of common link shorteners (host names only, not web addresses). */
const SHORTENER_HOSTS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "is.gd",
  "cutt.ly",
  "ow.ly",
  "rb.gy",
  "shorturl.at",
  "tiny.cc",
  "rebrand.ly",
  "s.id",
  "t.ly",
]);

const IP_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/u;

export type LinkSignal = "SHORTENED_LINK" | "NUMERIC_ADDRESS" | "ENCODED_NAME";

export const LINK_SIGNAL_DETAILS: Readonly<Record<LinkSignal, string>> = {
  SHORTENED_LINK: "the link is shortened, so its real destination is hidden",
  NUMERIC_ADDRESS: "the link uses a numeric address instead of a website name",
  ENCODED_NAME: "the link uses an encoded (punycode) name, which can imitate another name",
};

/** Structural signals of a web address (text already lower case). */
export function linkSignals(url: string): LinkSignal[] {
  const host = url
    .replace(/^[a-z]+:\/\//u, "")
    .replace(/^www\./u, "")
    .split(/[/?#:]/u, 1)[0]
    ?.replace(/^.*@/u, "");
  if (host === undefined || host === "") {
    return [];
  }
  const signals: LinkSignal[] = [];
  if (SHORTENER_HOSTS.has(host)) {
    signals.push("SHORTENED_LINK");
  }
  if (IP_HOST.test(host)) {
    signals.push("NUMERIC_ADDRESS");
  }
  if (host.split(".").some((label) => label.startsWith("xn--"))) {
    signals.push("ENCODED_NAME");
  }
  return signals;
}

function findLinks(text: string): RuleMatch[] {
  const requests = LINK_REQUEST_PATTERNS.flatMap((pattern) =>
    scan(text, pattern, { negatable: true }),
  );
  const signalled: RuleMatch[] = [];
  URL_PATTERN.lastIndex = 0;
  for (let found = URL_PATTERN.exec(text); found !== null; found = URL_PATTERN.exec(text)) {
    const start = found.index;
    const end = start + found[0].length;
    const signals = linkSignals(found[0]);
    if (signals.length === 0 || isNegated(text, start, end)) {
      continue;
    }
    signalled.push({
      start,
      end,
      evidenceType: "link",
      // Without a request to use it, a signalled link is only a weak indicator.
      strength: requests.length > 0 ? "MODERATE" : "WEAK",
      detail: signals.map((signal) => LINK_SIGNAL_DETAILS[signal]).join("; "),
    });
  }
  return [...requests, ...signalled];
}

export const LINK_RULES: readonly Rule[] = [
  {
    id: "SUSPICIOUS_LINK.request",
    indicator: "SUSPICIOUS_LINK",
    languages: ["EN", "SI", "TA"],
    description:
      "A request to click, open, visit, sign in or verify through a link (English, Sinhala and Tamil verbs), plus structural signals of the web address (shortener, numeric address, punycode) as additional evidence.",
    composite: false,
    find: findLinks,
  },
];
