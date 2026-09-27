/**
 * Composite rules: patterns that only count together with other detected indicators.
 *
 * - IMPERSONATION (Rule E): a claim to represent a bank, CBSL, the police or another authority is
 *   NOT an indicator on its own; it counts only with a suspicious request or pressure.
 * - Fraud-type patterns (section 9): investment schemes, unauthorised deposit-taking, pyramid
 *   schemes and fake loans. ScamShield identifies the pattern only; it never decides that a named
 *   business is unauthorised or a prohibited scheme.
 */
import type { IndicatorCode } from "../indicators/catalog.js";
import { LOAN_TERMS } from "./lexicon.js";
import {
  anyOf,
  compile,
  extendByWords,
  gap,
  occurs,
  scan,
  stem,
  word,
  type DetectedMatches,
  type Rule,
  type RuleMatch,
} from "./pattern.js";

function has(detected: DetectedMatches, ...codes: readonly IndicatorCode[]): boolean {
  return codes.some((code) => (detected.get(code)?.length ?? 0) > 0);
}

// ---------------------------------------------------------------------------------------------
// Rule E: impersonation + suspicious behaviour
// ---------------------------------------------------------------------------------------------

const INSTITUTIONS =
  "(?:(?:your|the|a|an|our) )?(?:bank|central bank|cbsl|police|cid|court|customs|inland revenue|tax (?:office|department)|government|ministry|telecom(?:munications)? (?:company|provider)|financial institution|finance company|(?:bank|police|government|cbsl) (?:officer|official|manager|staff|agent)|official agent|authori[sz]ed agent)";

const EN_CLAIM = word(
  anyOf(
    `(?:i am|i'm|im|we are|we're|this is|it's|it is|calling from|call(?:ing)? from|message from|sms from|email from|on behalf of|speaking from|representing|here from|writing from)${gap(20)}${INSTITUTIONS}`,
    `(?:he|she|they|the caller|someone|a man|a woman|a person) (?:said|says|claimed|claims|told me) (?:that )?(?:he|she|they|it)? ?(?:is|was|are|were)?${gap(15)}(?:from )?${INSTITUTIONS}`,
    `(?:claim(?:s|ed|ing)? to be|pretend(?:s|ed|ing)? to be|posing as|introduced (?:himself|herself|themselves) as|saying (?:he|she|they) (?:is|was|are|were))${gap(15)}(?:from )?${INSTITUTIONS}`,
    "(?:bank|police|government|cbsl|central bank|customs) (?:officer|official|manager|representative|agent|staff)|official agent|authori[sz]ed agent",
  ),
);

/**
 * Sinhala: "calling/saying from the (Central) Bank / police", "bank / police / government officer".
 */
const SI_CLAIM = anyOf(
  `${stem("මහ බැංකුවෙන්|බැංකුවෙන්|පොලිසියෙන්|පොලීසියෙන්|රේගුවෙන්|රජයෙන්")}${gap(10)}${stem("කතා කර|කියලා|කියා|ඇමතුම|කෝල්|පණිවිඩ|මැසේජ්")}`,
  stem("බැංකු නිලධාරි|පොලිස් නිලධාරි|රජයේ නිලධාරි|මහ බැංකු නිලධාරි"),
);

/** Tamil: "speaking/calling from the (Central) Bank / police", "bank / police / government officer". */
const TA_CLAIM = anyOf(
  `${stem("மத்திய வங்கியிலிருந்து|வங்கியிலிருந்து|பொலிஸிலிருந்து|காவல்துறையிலிருந்து")}${gap(10)}${stem("பேசு|அழை|கூறி|சொல்லி|செய்தி")}`,
  stem("வங்கி அதிகாரி|வங்கி உத்தியோகத்தர்|பொலிஸ் அதிகாரி|காவல்துறை அதிகாரி|அரசாங்க அதிகாரி"),
);

const CLAIM = compile(anyOf(EN_CLAIM, SI_CLAIM, TA_CLAIM));

/** Behaviour that makes an official-sounding claim suspicious. */
const SUSPICIOUS_BEHAVIOUR: readonly IndicatorCode[] = [
  "CREDENTIAL_REQUEST",
  "PERSONAL_INFORMATION_REQUEST",
  "PAYMENT_TRANSFER_REQUEST",
  "ADVANCE_PAYMENT",
  "SUSPICIOUS_LINK",
  "URGENCY_PRESSURE",
  "ACCOUNT_ACCESS_REQUEST",
];

// ---------------------------------------------------------------------------------------------
// Investment schemes: an investment offer together with unrealistic return claims
// ---------------------------------------------------------------------------------------------

const INVESTMENT = compile(
  anyOf(
    word(
      "invest(?:ment|ments|ing|or|ors)?|plantation|agarwood|sandalwood|trading (?:platform|scheme|account|bot|plan)|forex|crypto(?:currency|currencies)?|bitcoin|mining (?:scheme|plan|pool)|share market|stock market|(?:investment|money|savings|business) (?:scheme|plan)",
    ),
    // Sinhala: investment, crypto, cultivation project.
    stem("ආයෝජන|ක්රිප්ටෝ|වගා ව්යාපෘති"),
    // Tamil: investment, crypto, bitcoin, trading platform, plantation.
    stem("முதலீ|கிரிப்டோ|பிட்காயின்|வர்த்தக தள|பெருந்தோட்ட"),
  ),
);

// ---------------------------------------------------------------------------------------------
// Unauthorised deposit-taking: collecting money as deposits with high or unrealistic returns
// ---------------------------------------------------------------------------------------------

const DEPOSIT_TAKING = compile(
  anyOf(
    word(
      "deposit(?:s|ing)? (?:your |the )?(?:money|savings|funds|cash)|fixed deposits?|deposit scheme|deposit with us|(?:accept|accepts|accepting|take|takes|taking|collect|collects|collecting) (?:deposits|money from (?:the )?public|savings)|(?:place|keep|put|save) (?:your )?(?:money|savings|funds|cash) (?:with us|in our (?:company|scheme|fund|society|business))",
    ),
    // Sinhala: deposit (තැන්පතු, තැන්පත් කරන්න ...).
    stem("තැන්පත"),
    // Tamil: deposit.
    stem("வைப்பு|வைப்பில்|டெபாசிட்"),
  ),
);

/** Returns promised above those of banks: an indicator of deposit-taking without a licence. */
const ABOVE_BANKS = compile(
  anyOf(
    word(
      "(?:higher|better|more|double) (?:interest|returns?|rates?|profits?) than (?:any |the |other |normal )?(?:banks?|fixed deposits?|finance companies)|(?:high|higher|very high) interest (?:rates? )?(?:on|for) (?:your )?(?:deposits?|savings|money)",
    ),
    `${stem("බැංකුවලට වඩා|බැංකුවට වඩා")}${gap(15)}${stem("පොලී|ලාභ|ප්රතිලාභ")}`,
    stem("ඉහළ පොලී"),
    `${stem("வங்கிகளை விட|வங்கியை விட")}${gap(15)}${stem("வட்டி|லாப|வருமான")}`,
    stem("அதிக வட்டி"),
  ),
);

// ---------------------------------------------------------------------------------------------
// Pyramid schemes: earnings from recruiting new members
// ---------------------------------------------------------------------------------------------

const RECRUITMENT = compile(
  anyOf(
    word(
      "(?:recruit|bring|introduce|refer|invite|enrol|enroll|add|sign up|get)(?:s|ed|ing)? (?:in |up )?(?:\\d+ |one |two |three |four |five |ten |more |new |other |your )?(?:new )?(?:members?|people|persons|friends|recruits|referrals|others|downlines?|investors)",
    ),
    // Sinhala: members / friends / new people + add / bring / recruit / introduce.
    `${stem("සාමාජිකයන්|සාමාජිකයින්|සාමාජිකයෝ|සාමාජිකයෙක්|යාළුවන්|මිතුරන්|අලුත් අය|තවත් අය")}${gap(20)}${stem("එකතු කර|ගෙනෙන්න|ගෙනාවොත්|බඳවා|හඳුන්වා|සම්බන්ධ කර")}`,
    // Tamil: members / friends / persons + add / introduce / join / bring.
    `${stem("உறுப்பினர்|நண்பர்|நபர்|புதியவர்")}${gap(20)}${stem("சேர்|அறிமுக|இணை|கொண்டு வா|கொண்டுவா")}`,
  ),
);

const RECRUITMENT_EARNINGS = compile(
  anyOf(
    word(
      "earn\\w*|commissions?|bonus(?:es)?|income|profits?|get paid|paid|rewards?|money|rs\\.? ?\\d[\\d,]*",
    ),
    stem("කොමිස්|ලාභ|ආදායම|බෝනස්|මුදල් ලැබ|රු"),
    stem("கமிஷன்|கமிசன்|வருமான|லாப|போனஸ்|சம்பாதி|ரூ"),
  ),
);

/** Explicit pyramid wording that counts on its own. */
const PYRAMID_EXPLICIT = compile(
  word(
    anyOf(
      "the more (?:people|members|friends|persons|investors) you (?:bring|recruit|introduce|add|refer|invite|join)",
      "(?:for|on) (?:each|every) (?:new )?(?:member|person|recruit|referral|friend|investor) (?:you )?(?:bring|introduce|recruit|refer|invite|add|join)",
      "downlines?|upline|binary plan|matrix plan",
    ),
  ),
);

/** Returns paid from new members' money: the defining pyramid mechanism (STRONG). */
const RETURNS_FROM_MEMBERS = compile(
  word(
    "(?:returns?|profits?|payments?|income|earnings) (?:come|comes|depend|depends|are paid|is paid) (?:from|on) (?:the )?(?:new )?(?:members|recruits|investors|joiners)",
  ),
);

/** Paying to join: makes the recruitment pattern STRONG. */
const PAY_TO_JOIN = compile(
  anyOf(
    word(
      "(?:joining|membership|registration|entrance|entry|starter) (?:fee|payment|cost|package|kit)|(?:buy|purchase) (?:a |the )?(?:package|starter kit|membership)",
    ),
    `${word("pay|invest|deposit")}${gap(20)}${word("to join")}`,
    `${word("join")}${gap(15)}${word("pay|invest|deposit")}`,
  ),
);

const EARNINGS_WINDOW = 60;

function findPyramid(text: string, detected: DetectedMatches): RuleMatch[] {
  const strongContext =
    occurs(text, PAY_TO_JOIN) ||
    occurs(text, RETURNS_FROM_MEMBERS) ||
    has(detected, "UNREALISTIC_RETURN");
  const strength = strongContext ? "STRONG" : "MODERATE";
  const matches: RuleMatch[] = [];
  for (const recruitment of scan(text, RECRUITMENT, { negatable: true })) {
    const from = Math.max(0, recruitment.start - EARNINGS_WINDOW);
    const window = text.slice(from, recruitment.end + EARNINGS_WINDOW);
    const earning = scan(window, RECRUITMENT_EARNINGS)[0];
    if (earning === undefined) {
      continue;
    }
    matches.push({
      start: Math.min(recruitment.start, from + earning.start),
      end: Math.max(recruitment.end, from + earning.end),
      evidenceType: "phrase",
      strength,
    });
  }
  for (const explicit of [
    ...scan(text, PYRAMID_EXPLICIT, { negatable: true }),
    ...scan(text, RETURNS_FROM_MEMBERS, { negatable: true }),
  ]) {
    matches.push({ ...explicit, strength });
  }
  return matches;
}

// ---------------------------------------------------------------------------------------------
// Fake loans: a loan offer with an upfront fee, a credential request, or unusually easy terms
// ---------------------------------------------------------------------------------------------

const LOAN = compile(LOAN_TERMS);

const EASY_LOAN_TERMS = compile(
  anyOf(
    word(
      anyOf(
        "(?:instant|immediate|quick|fast|easy|guaranteed|100%) (?:loan )?approv(?:al|ed)|approved (?:without|with no|in (?:\\d+|a few) (?:minutes?|hours?))|pre-?approved",
        "no (?:documents?|documentation|guarantors?|credit checks?|paperwork|collateral|security)(?: (?:needed|required))?|without (?:any )?(?:documents?|guarantors?|credit checks?|collateral|paperwork)",
        "(?:guaranteed|easy|instant|quick) (?:loans?|cash|credit)|loans? (?:approved|disbursed|released|in your account) (?:in|within) (?:\\d+|a few|few) (?:minutes?|hours?)",
      ),
    ),
    // Sinhala: instant / easy / quick / guaranteed loan; without guarantors; without documents.
    `${stem("ක්ෂණික|පහසු|ඉක්මන්|සහතික")}${gap(5)}${stem("ණය")}`,
    stem("ඇපකරුවන් නැතිව|ඇපකරුවන් රහිතව|ඇපකරුවන් අවශ්ය නැත|ලේඛන නැතිව|ලේඛන අවශ්ය නැත"),
    // Tamil: instant / easy / quick / guaranteed loan; without documents; without guarantor.
    `${stem("உடனடி|எளிதான|விரைவான|உத்தரவாத")}${gap(5)}${stem("கடன")}`,
    stem(
      "ஆவணங்கள் இல்லாமல்|ஆவணங்கள் தேவையில்லை|பிணையாளர் இல்லாமல்|பிணை இல்லாமல்|பிணையாளர் தேவையில்லை",
    ),
  ),
);

const LOAN_DETAIL_FEE = "a request for an upfront fee";
const LOAN_DETAIL_CREDENTIALS = "a request for a PIN, password or OTP";
const LOAN_DETAIL_EASY_TERMS = "unusually easy approval terms";

function findFakeLoan(text: string, detected: DetectedMatches): RuleMatch[] {
  const loans = scan(text, LOAN);
  if (loans.length === 0) {
    return [];
  }
  const easyTerms = scan(text, EASY_LOAN_TERMS, { negatable: true });
  const withFee = has(detected, "ADVANCE_PAYMENT");
  const withCredentials = has(detected, "CREDENTIAL_REQUEST");
  if (!withFee && !withCredentials && easyTerms.length === 0) {
    return [];
  }
  const details = [
    ...(withFee ? [LOAN_DETAIL_FEE] : []),
    ...(withCredentials ? [LOAN_DETAIL_CREDENTIALS] : []),
    ...(easyTerms.length > 0 ? [LOAN_DETAIL_EASY_TERMS] : []),
  ];
  // Easy terms alone are a moderate sign; a fee or credential request makes it strong.
  const strength = withFee || withCredentials ? "STRONG" : "MODERATE";
  const evidence = easyTerms.length > 0 ? easyTerms : loans.slice(0, 1);
  return evidence.map((match, index) => ({
    ...match,
    strength,
    // The details describe the whole indicator; attach them once.
    ...(index === 0 ? { detail: details.join(" and ") } : {}),
  }));
}

export const SCHEME_RULES: readonly Rule[] = [
  {
    id: "IMPERSONATION.with-suspicious-request",
    indicator: "IMPERSONATION",
    languages: ["EN", "SI", "TA"],
    description:
      "A claim to be from a bank, CBSL, the police or another authority, counted ONLY when the content also asks for credentials, details, money or a link, or applies urgency.",
    composite: true,
    find: (text, detected) =>
      has(detected, ...SUSPICIOUS_BEHAVIOUR) ? scan(text, CLAIM, { negatable: true }) : [],
  },
  {
    id: "INVESTMENT_SCHEME.with-unrealistic-returns",
    indicator: "INVESTMENT_SCHEME",
    languages: ["EN", "SI", "TA"],
    description:
      "An investment offer (investment, plantation, trading, crypto …) together with an unrealistic-return claim.",
    composite: true,
    find: (text, detected) =>
      has(detected, "UNREALISTIC_RETURN")
        ? scan(text, INVESTMENT)
            .slice(0, 1)
            .map((match) => extendByWords(text, match, 4))
        : [],
  },
  {
    id: "UNAUTHORIZED_DEPOSIT_INDICATOR.deposits-with-high-returns",
    indicator: "UNAUTHORIZED_DEPOSIT_INDICATOR",
    languages: ["EN", "SI", "TA"],
    description:
      "Collecting money as deposits together with unrealistic returns or returns promised above those of banks.",
    composite: true,
    find: (text, detected) => {
      const aboveBanks = scan(text, ABOVE_BANKS);
      if (!has(detected, "UNREALISTIC_RETURN") && aboveBanks.length === 0) {
        return [];
      }
      const deposits = scan(text, DEPOSIT_TAKING, { negatable: true });
      return deposits.length === 0 ? [] : [...deposits, ...aboveBanks];
    },
  },
  {
    id: "PYRAMID_SCHEME_INDICATOR.recruitment-earnings",
    indicator: "PYRAMID_SCHEME_INDICATOR",
    languages: ["EN", "SI", "TA"],
    description:
      "Earnings linked to recruiting members (recruit/bring/introduce people + commission/income nearby), or explicit wording (the more people you bring, downline, returns paid from new members). STRONG with a payment to join, returns from new members or unrealistic returns.",
    composite: true,
    find: findPyramid,
  },
  {
    id: "FAKE_LOAN_OFFER.loan-with-fee-credentials-or-easy-terms",
    indicator: "FAKE_LOAN_OFFER",
    languages: ["EN", "SI", "TA"],
    description:
      "A loan offer together with an advance payment or credential request (STRONG), or with unusually easy approval terms such as no documents or instant approval (MODERATE).",
    composite: true,
    find: findFakeLoan,
  },
];
