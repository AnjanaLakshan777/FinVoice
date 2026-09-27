/**
 * Pressure and bait: urgency and fear (Rule B), unexpected offers (Rule D) and reassurance that a
 * request is safe or official. These are context signals: common in scams, but also in ordinary
 * messages, so on their own they are WEAK indicators.
 */
import { anyOf, compile, gap, patternRule, stem, word, type Rule } from "./pattern.js";

// ---------------------------------------------------------------------------------------------
// Rule B: urgency (pressure to act before there is time to check). A bare "today" is not urgency.
// ---------------------------------------------------------------------------------------------

const EN_URGENCY = word(
  anyOf(
    "act (?:now|immediately|fast|quickly|today|right away|at once)",
    "urgent(?:ly)?|immediately|right away|right now|at once|asap|as soon as possible|hurry(?: up)?|without delay|don't delay|do not delay|no time to (?:lose|waste)",
    "last chance|final (?:notice|warning|reminder|chance|opportunity)|limited[- ]time",
    "(?:offer|deal|opportunity|link|code|otp|prize|reward) (?:ends|expires|is valid only|valid only|will expire)",
    "expires? (?:today|tonight|soon|in \\d+)|only (?:today|for today|\\d+ (?:hours?|minutes?|days?) left)|today only",
    "before (?:midnight|it(?:'s| is) too late|\\d{1,2}(?:[.:]\\d{2})? ?(?:am|pm))",
    "within (?:the next )?\\d+ (?:minutes?|mins?|hours?|hrs?)|in the next \\d+ (?:minutes?|mins?|hours?|hrs?)",
    "(?:account|card|number|sim|connection|service|profile|wallet|access)s? (?:will|would|is going to|are going to|shall) be (?:closed|blocked|suspended|locked|deactivated|terminated|cancell?ed|frozen|disabled|restricted|deleted)",
    "(?:you will|you'll|you would|you'd) (?:be arrested|be fined|be charged|be prosecuted|face legal action|lose (?:your|the) (?:money|prize|account|chance|opportunity))",
    "legal action will be taken|arrest warrant",
    "(?:reply|respond|call|pay|send|transfer|click|confirm|register|join|invest|apply|verify|deposit) (?:it |them |us |back )?(?:now|immediately|right away|today)",
  ),
);

/**
 * Sinhala: quickly, immediately, urgent, right now, today only, last chance/day, within N minutes
 * or hours, the account will be blocked/closed/suspended/deactivated, arrest, legal action.
 */
const SI_URGENCY = anyOf(
  stem(
    "ඉක්මනින්|වහාම|හදිසි|හදිස්සි|දැන්ම|අද පමණ|අද විතරයි|අවසාන අවස්ථාව|අවසාන දිනය|අත්අඩංගුවට|නීතිමය ක්රියාමාර්ග",
  ),
  `(?:${stem("විනාඩි|පැය")} ?\\d+|\\d+ ?${stem("විනාඩි|පැය")})${gap(5)}${stem("ඇතුළත")}`,
  `${stem("ගිණුම")}${gap(25)}${stem("අවහිර|වසා දම|අත්හිටුව|අක්රිය")}`,
);

/**
 * Tamil: immediately, urgent, right now, today only, last chance/day, within N minutes/hours, the
 * account will be frozen/closed/blocked/suspended/deactivated, arrest, legal action.
 */
const TA_URGENCY = anyOf(
  stem("உடனடியாக|உடனே|அவசர|இப்போதே|இன்று மட்டும்|கடைசி வாய்ப்பு|கடைசி நாள்|கைது|சட்ட நடவடிக்கை"),
  `\\d+ ?${stem("நிமிடங்களுக்குள்|நிமிடத்திற்குள்|நிமிடத்துக்குள்|மணி ?நேரத்திற்குள்|மணித்தியாலத்திற்குள்")}`,
  `${stem("கணக்கு")}${gap(25)}${stem("முடக்க|மூட|தடுக்க|இடைநிறுத்த|செயலிழ")}`,
);

export const URGENCY_RULES: readonly Rule[] = [
  patternRule({
    id: "URGENCY_PRESSURE.en",
    indicator: "URGENCY_PRESSURE",
    languages: ["EN"],
    description:
      "Pressure to act at once (act now, urgent, last chance, within N minutes), threats that an account will be closed or blocked, or threats of arrest or legal action.",
    patterns: [compile(EN_URGENCY)],
  }),
  patternRule({
    id: "URGENCY_PRESSURE.si-ta",
    indicator: "URGENCY_PRESSURE",
    languages: ["SI", "TA"],
    description:
      "Sinhala and Tamil wording for immediately, urgent, last chance, within N minutes, account closure and arrest.",
    patterns: [compile(anyOf(SI_URGENCY, TA_URGENCY))],
  }),
];

// ---------------------------------------------------------------------------------------------
// Rule D: unexpected offers (prizes, rewards, selections, jobs, refunds, account "problems")
// ---------------------------------------------------------------------------------------------

const EN_UNSOLICITED = word(
  anyOf(
    "(?:you|u)(?: have| ?'ve| has)? (?:won|been selected|been chosen|been shortlisted|been picked|qualified)",
    "(?:you are|you're|u r|you have become) (?:a |the |our )?(?:lucky |grand |prize )?(?:winner|selected)",
    "lottery|lucky draw|jackpot|sweepstakes?|raffle|grand prize|cash prize",
    "(?:claim|collect|redeem|receive|get) (?:your|the|a) (?:free |cash )?(?:prize|reward|gift|winnings|bonus|cash|refund|voucher)",
    "free (?:gift|reward|prize|money|cash|voucher)|pre-?(?:approved|qualified|selected)",
    "(?:job|work|employment) (?:offer|opportunity)|work from home|part[- ]time (?:job|work)|online (?:job|work)|(?:we are|we're) hiring",
    "earn (?:money|income|rs\\.? ?[\\d,]+|[\\d,]+) (?:daily|per day|a day|from home|online|weekly)",
    "(?:you are|you're|you have been) (?:entitled|eligible) (?:to|for) (?:a |an )?(?:refund|compensation|grant|payment|reward|prize|loan|bonus|subsidy)",
    "(?:sent|credited|transferred|deposited) (?:\\w+ ){0,4}?(?:to|into) your account by mistake|sent (?:it |money |the money )?(?:to you |to your account )?by mistake",
    "(?:problem|issue|unusual activity|suspicious activity|security issue) (?:with|on|in|detected (?:on|in)) your (?:account|card|wallet)",
  ),
);

/**
 * Sinhala: win/victory, "has won", won, draws, prize, lottery, lucky, gift, "has been selected",
 * job opportunities, from home, bonus.
 */
const SI_UNSOLICITED = stem(
  "ජයග්රහණය|දිනා ඇත|දිනුවා|දිනුම්|ත්යාග|ලොතරැයි|වාසනාවන්ත|තෑගි|තෝරාගෙන ඇත|තෝරා ගෙන ඇත|රැකියා අවස්ථා|නිවසේ සිට|ප්රසාද දීමනා",
);

/**
 * Tamil: "you have won", winner, prize, lottery, lucky, draw, "you have been selected", job
 * opportunity, from home, free.
 */
const TA_UNSOLICITED = stem(
  "வென்றுள்ளீர்கள்|வென்றீர்கள்|வெற்றி பெற்றுள்ளீர்கள்|வெற்றியாளர்|பரிசு|லாட்டரி|அதிர்ஷ்ட|குலுக்கல்|தெரிவு செய்யப்பட்டுள்ளீர்கள்|தேர்ந்தெடுக்கப்பட்டுள்ளீர்கள்|வேலை வாய்ப்பு|வீட்டிலிருந்து|இலவச",
);

export const UNSOLICITED_RULES: readonly Rule[] = [
  patternRule({
    id: "UNSOLICITED_OFFER.en",
    indicator: "UNSOLICITED_OFFER",
    languages: ["EN"],
    description:
      "Announcements of a prize, win, lottery, reward, pre-approval, job offer, refund or entitlement, money 'sent by mistake', or a 'problem with your account'.",
    patterns: [compile(EN_UNSOLICITED)],
  }),
  patternRule({
    id: "UNSOLICITED_OFFER.si-ta",
    indicator: "UNSOLICITED_OFFER",
    languages: ["SI", "TA"],
    description:
      "Sinhala and Tamil words for winning, prizes, lotteries, lucky draws, selection and job offers.",
    patterns: [compile(anyOf(SI_UNSOLICITED, TA_UNSOLICITED))],
  }),
];

// ---------------------------------------------------------------------------------------------
// Other: insisting that the request is safe, genuine or official
// ---------------------------------------------------------------------------------------------

const EN_REASSURANCE = word(
  anyOf(
    "(?:it is|it's|this is|that is|that's|everything is) (?:completely |totally |100% |perfectly |absolutely )?(?:safe|secure|legal|legitimate|genuine|official)",
    "(?:completely|totally|100%|perfectly|absolutely) (?:safe|secure|legal|legitimate|genuine)",
    "approved by (?:the )?(?:central bank|cbsl|government)|trust me",
  ),
);

/** Sinhala: "it is safe", completely safe, "it is legal", "trust me/us". */
const SI_REASSURANCE = stem(
  "ආරක්ෂිතයි|සම්පූර්ණයෙන්ම ආරක්ෂිත|නීත්යානුකූලයි|මාව විශ්වාස කරන්න|අපිව විශ්වාස කරන්න",
);
/** Tamil: "it is safe", completely safe, "it is legal", "trust me". */
const TA_REASSURANCE = stem(
  "பாதுகாப்பானது|முற்றிலும் பாதுகாப்பான|சட்டப்பூர்வமானது|என்னை நம்புங்கள்",
);

export const OTHER_RULES: readonly Rule[] = [
  patternRule({
    id: "OTHER_SUSPICIOUS_PATTERN.reassurance",
    indicator: "OTHER_SUSPICIOUS_PATTERN",
    languages: ["EN", "SI", "TA"],
    description: "Insisting that the request is safe, legal, genuine or official, or 'trust me'.",
    patterns: [compile(anyOf(EN_REASSURANCE, SI_REASSURANCE, TA_REASSURANCE))],
  }),
];
