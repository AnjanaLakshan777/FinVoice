/**
 * Money patterns: unrealistic returns (Rule C), fees before a promised benefit (Rule F) and
 * unrecognised transactions (Rule G).
 *
 * Rule C detects the PROMISE (guaranteed, risk-free, per-day or per-month returns, doubling), never
 * the size of a number: a large amount on its own is not an indicator.
 */
import {
  anyOf,
  compile,
  gap,
  occurs,
  patternRule,
  scan,
  stem,
  word,
  type Rule,
  type RuleMatch,
} from "./pattern.js";

// ---------------------------------------------------------------------------------------------
// Rule C: unrealistic returns
// ---------------------------------------------------------------------------------------------

const EN_RETURN_WORDS =
  "returns?|profits?|income|earnings|payouts?|dividends?|gains?|earn(?:s|ing)?";
const PERIOD_RATE =
  "\\d+(?:\\.\\d+)? ?% (?:\\w+ ){0,2}?(?:per|a|every|each|\\/) ?(?:day|week|month)|\\d+(?:\\.\\d+)? ?% (?:daily|weekly|monthly)";

const EN_UNREALISTIC = anyOf(
  word(
    anyOf(
      "guarantee(?:d|s)? (?:\\w+ ){0,2}?(?:returns?|profits?|income|earnings|payouts?|dividends?|interest|gains?|money)",
      "(?:returns?|profits?|income|earnings|payouts?) (?:are |is )?(?:100% )?guaranteed",
      "risk[- ]free|no risk|zero risk|without (?:any )?risk|no chance of (?:a )?loss|can(?:not|'t) lose",
      "(?:double|triple|multiply) (?:your|the) (?:money|investment|cash|savings)|(?:double|triple|\\d+ ?x|\\d+ times) (?:your |the )?(?:money|investment|returns?)",
      "(?:high|huge|big|massive|unbelievable|extraordinary|very high|extremely high|unusually high|attractive) (?:returns?|profits?|income|earnings|payouts?)",
      "(?:quick|fast|instant|easy) (?:returns?|profits?|money|cash|income)|get rich quick|overnight (?:profits?|returns?|riches)",
      "(?:even|also) (?:if|when) (?:the )?(?:crops?|harvest|business|market|plantation|investment) (?:fails?|loses?|is lost|goes down)",
    ),
  ),
  // A return promised per day, week or month ("earn 20% per month"), not a loan's interest rate.
  `${word(EN_RETURN_WORDS)}${gap(30)}(?:${PERIOD_RATE})`,
  `(?:${PERIOD_RATE})${gap(30)}${word(EN_RETURN_WORDS)}`,
);

const SI_RETURN_WORDS = stem("ලාභ|ප්රතිලාභ|ආදායම");
const SI_PERIOD = stem("දිනකට|සතියකට|මසකට|මාසයකට|මාසිකව");

/**
 * Sinhala: guaranteed (සහතික) profit/returns/income, risk-free, high/large returns, doubling money,
 * quick/instant profit, a percentage per day/week/month next to a profit word.
 */
const SI_UNREALISTIC = anyOf(
  `${stem("සහතික")}${gap(15)}(?:${SI_RETURN_WORDS}|${stem("පොලී")})`,
  `${SI_RETURN_WORDS}${gap(15)}${stem("සහතික")}`,
  stem("අවදානම් රහිත|අවදානමක් නැති|කිසිදු අවදානමක් නැති|අවදානමක් නැත"),
  `${stem("ඉහළ|විශාල|අධික|ඉමහත්|ඉක්මන්|ක්ෂණික")}${gap(5)}${SI_RETURN_WORDS}`,
  `${stem("මුදල්|ආයෝජනය")}${gap(10)}${stem("දෙගුණ")}`,
  `${SI_PERIOD}${gap(10)}\\d+(?:\\.\\d+)? ?%${gap(15)}${SI_RETURN_WORDS}`,
  `${SI_RETURN_WORDS}${gap(20)}${SI_PERIOD}${gap(10)}\\d+(?:\\.\\d+)? ?%`,
);

const TA_RETURN_WORDS = stem("லாப|வருமான|வருவாய்");

/**
 * Tamil: guaranteed (உத்தரவாத) profit/income/interest, risk-free, high/large profit, doubling,
 * quick/instant profit.
 */
const TA_UNREALISTIC = anyOf(
  `${stem("உத்தரவாத")}${gap(15)}(?:${TA_RETURN_WORDS}|${stem("வட்டி")})`,
  `${TA_RETURN_WORDS}${gap(15)}${stem("உத்தரவாத")}`,
  `${stem("ஆபத்து|அபாய|ரிஸ்க்")}(?:ம்)? ${stem("இல்லாத|இல்லை|அற்ற")}`,
  stem("அபாயமற்ற|ஆபத்தற்ற|நட்டம் இல்லாத|இரட்டிப்பு|இருமடங்கு"),
  `${stem("அதிக|மிக அதிக|பெரும்|பெரிய|விரைவான|உடனடி|எளிதான")}${gap(5)}${TA_RETURN_WORDS}`,
);

export const UNREALISTIC_RETURN_RULES: readonly Rule[] = [
  patternRule({
    id: "UNREALISTIC_RETURN.en",
    indicator: "UNREALISTIC_RETURN",
    languages: ["EN"],
    description:
      "Promises of guaranteed, risk-free, high, quick or doubled returns, returns 'even if the crop fails', or a percentage return per day, week or month.",
    patterns: [compile(EN_UNREALISTIC)],
  }),
  patternRule({
    id: "UNREALISTIC_RETURN.si-ta",
    indicator: "UNREALISTIC_RETURN",
    languages: ["SI", "TA"],
    description:
      "Sinhala and Tamil wording for guaranteed, risk-free, high, quick or doubled returns.",
    patterns: [compile(anyOf(SI_UNREALISTIC, TA_UNREALISTIC))],
  }),
];

// ---------------------------------------------------------------------------------------------
// Rule F: advance payment (a fee before receiving a promised prize, loan, job or money)
// ---------------------------------------------------------------------------------------------

/** Named fees that only matter when the content also promises a benefit. */
const FEE_PHRASES = anyOf(
  word(
    "(?:processing|release|releasing|activation|registration|clearance|handling|approval|unlock(?:ing)?|verification|insurance|customs|documentation|legal|stamp|transfer|service|admin(?:istration)?|tax|joining|membership) (?:fee|fees|charge|charges|cost|payment|deposit)|(?:a |the )?small (?:fee|payment|charge|deposit|amount)",
  ),
  // Sinhala: processing / registration / release / activation / service / customs / tax /
  // administration fee (ගාස්තු).
  `${stem("සැකසුම්|ලියාපදිංචි|නිදහස් කිරීමේ|සක්රිය කිරීමේ|සේවා|රේගු|බදු|පරිපාලන")}${gap(5)}${stem("ගාස්තු")}`,
  `${stem("ගාස්තු")}${gap(30)}${stem("ගෙවන්න|එවන්න|ගෙවිය යුතු")}`,
  // Tamil: processing / registration / release / customs / tax / service / administration fee.
  `${stem("செயலாக்க|பதிவு|விடுவிப்பு|சுங்க|வரி|சேவை|நிர்வாக")}${gap(3)}${stem("கட்டண")}`,
  `${stem("கட்டணம்|கட்டணத்தை")}${gap(30)}${stem("செலுத்த|அனுப்ப")}`,
);

/** The promised benefit that a fee is supposedly needed for. */
const BENEFIT = compile(
  anyOf(
    word(
      "prizes?|rewards?|winnings|lottery|gifts?|loans?|jobs?|refunds?|compensation|inheritance|grants?|funds|bonus|profits?|visa|salary|money you (?:won|are owed)",
    ),
    // Sinhala: prize, lottery, loan, job, gift, winnings, bonus.
    stem("ත්යාග|ලොතරැයි|ණය|රැකියා|තෑගි|දිනුම|ප්රසාද"),
    // Tamil: prize, lottery, loan, job, reward.
    stem("பரிசு|லாட்டரி|கடன|வேலை|வெகுமதி"),
  ),
);

/** Payment explicitly required first: on its own an advance-payment request. */
const PAY_FIRST = compile(
  anyOf(
    word(
      "advance (?:fee|payment|deposit)|pay(?:ment)? (?:first|upfront|up front|in advance|beforehand)|(?:upfront|up front) (?:payment|fee|deposit)",
    ),
    // "pay Rs. 2,000 to release your prize": the payment unlocks a promised benefit.
    `${word("pay|deposit|send")}${gap(40)}${word("(?:before|in order to|so that you can|so you can|first to|to) (?:\\w+ )?(?:receive|release|claim|get|unlock|collect|withdraw|activate|process) (?:\\w+ ){0,2}?(?:prizes?|rewards?|winnings|gifts?|loans?|jobs?|refunds?|money|funds|compensation|bonus|salary|profits?)")}`,
    // Sinhala: advance (අත්තිකාරම්), "first/beforehand ... pay".
    stem("අත්තිකාරම්"),
    `${stem("කලින්|මුලින්|පළමුව|ඉස්සරලා|ඉස්සර වෙලා")}${gap(20)}${stem("ගෙවන්න|ගාස්තු")}`,
    // Tamil: advance payment, "first/in advance ... pay".
    stem("முன்பணம்|முன் பணம்|முற்பணம்"),
    `${stem("முதலில்|முன்கூட்டியே")}${gap(20)}${stem("செலுத்த|கட்டண")}`,
  ),
);

const FEE_PATTERN = compile(FEE_PHRASES);

function findAdvancePayments(text: string): RuleMatch[] {
  const explicit = scan(text, PAY_FIRST, { negatable: true });
  const fees = occurs(text, BENEFIT) ? scan(text, FEE_PATTERN, { negatable: true }) : [];
  return [...explicit, ...fees];
}

export const ADVANCE_PAYMENT_RULES: readonly Rule[] = [
  {
    id: "ADVANCE_PAYMENT.fee-before-benefit",
    indicator: "ADVANCE_PAYMENT",
    languages: ["EN", "SI", "TA"],
    description:
      "Payment required first (advance fee, pay upfront, pay to release/claim/unlock), or a named fee (processing, release, activation, clearance, tax …) in content that promises a prize, loan, job, refund or other money.",
    composite: false,
    find: findAdvancePayments,
  },
];

// ---------------------------------------------------------------------------------------------
// Rule G: unrecognised transactions (the negation is part of the pattern, so it is not negatable)
// ---------------------------------------------------------------------------------------------

const TRANSACTION =
  "payments?|transactions?|transfers?|charges?|debits?|withdrawals?|deductions?|purchases?";

const EN_UNKNOWN_TRANSACTION = word(
  anyOf(
    `(?:don't|do not|didn't|did not|can't|cannot|couldn't|could not|doesn't|does not) (?:recogni[sz]e|know(?: about)?|remember(?: making)?) (?:this |the |that |a |an |these |those |some |any |two |several )?(?:\\w+ ){0,2}?(?:${TRANSACTION})`,
    `(?:unrecogni[sz]ed|unknown|unauthori[sz]ed|unfamiliar|strange|fraudulent|suspicious) (?:card |bank |online )?(?:${TRANSACTION})`,
    `(?:${TRANSACTION}) (?:that |which )?(?:i|we) (?:didn't|did not|never|have not|haven't) (?:make|made|do|did|done|authori[sz]e|authori[sz]ed|initiate|initiated|start|started|approve|approved)`,
    `(?:i|we) (?:didn't|did not|never|have not|haven't) (?:make|made|do|did|authori[sz]e|authori[sz]ed|initiate|initiated|approve|approved|start|started) (?:this|that|the|these|those|a|an|any) (?:\\w+ )?(?:${TRANSACTION})`,
    "(?:money|funds|cash|rs\\.? ?[\\d,]+) (?:was|were|has been|have been|got) (?:taken|deducted|debited|withdrawn|transferred|removed) (?:from (?:my|our) (?:account|card) )?without (?:my|our|any) (?:permission|knowledge|consent|approval)",
  ),
);

/** Sinhala: "not done / unknown / unrecognised / unauthorised" + transaction or payment; "I didn't do it". */
const SI_UNKNOWN_TRANSACTION = anyOf(
  `${stem("නොකළ|නොකරපු|නොදන්නා|හඳුනා නොගත්|හඳුනා නොගන්නා|හඳුනාගත නොහැකි|නොහඳුනන|අනවසර|අනුමැතියකින් තොර")}${gap(15)}${stem("ගනුදෙනු|ගෙවීම|මුදල් කැපීම|හුවමාරු")}`,
  `${stem("ගනුදෙනු|ගෙවීම")}${gap(30)}${stem("මම|අපි|මා")}${gap(10)}${stem("කළේ|කරපු|කළ")} ${stem("නැහැ|නැත|නෑ")}`,
);

/** Tamil: "not done / unknown / unauthorised" + transaction or payment; "I did not do it". */
const TA_UNKNOWN_TRANSACTION = anyOf(
  `${stem("செய்யாத|செய்யவில்லை|அறியாத|தெரியாத|அடையாளம் தெரியாத|அங்கீகரிக்கப்படாத|அனுமதியற்ற|அனுமதியில்லாத")}${gap(15)}${stem("பரிவர்த்தனை|கொடுப்பனவு|பணப் பரிமாற்ற|பரிமாற்ற")}`,
  `${stem("பரிவர்த்தனை|கொடுப்பனவு")}${gap(30)}${stem("நான்|நாங்கள்")}${gap(10)}${stem("செய்யவில்லை")}`,
);

export const UNKNOWN_TRANSACTION_RULES: readonly Rule[] = [
  patternRule({
    id: "UNKNOWN_TRANSACTION.en",
    indicator: "UNKNOWN_TRANSACTION",
    languages: ["EN"],
    description:
      "Descriptions of a payment or transaction that is not recognised, unauthorised or not made by the user, or money taken without permission.",
    patterns: [compile(EN_UNKNOWN_TRANSACTION)],
  }),
  patternRule({
    id: "UNKNOWN_TRANSACTION.si-ta",
    indicator: "UNKNOWN_TRANSACTION",
    languages: ["SI", "TA"],
    description: "Sinhala and Tamil descriptions of an unrecognised or unauthorised transaction.",
    patterns: [compile(anyOf(SI_UNKNOWN_TRANSACTION, TA_UNKNOWN_TRANSACTION))],
  }),
];
