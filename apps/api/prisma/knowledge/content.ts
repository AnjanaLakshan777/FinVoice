/**
 * Curated financial-literacy knowledge: the initial content of the knowledge base.
 *
 * Content rules (docs/architecture/financial-knowledge-base.md):
 * - Every statement is based on the cited source, and the English text is canonical.
 * - Plain, short sentences for readers with limited financial or digital experience.
 * - No product or institution recommendations, no promises, no personal advice.
 * - Facts that can change (amounts, limits, rules) are marked time-sensitive with review dates.
 * - Translations add nothing: no new claims, numbers or rules.
 * - All text is MACHINE_ASSISTED (drafted with machine assistance, not yet reviewed by a qualified
 *   person); none of it is the source's official wording, so none is OFFICIAL.
 *
 * All sources were read on 26 September 2026, and each claim was checked against the source text.
 * The seed inserts this content only where it is missing (prisma/knowledge/seed-knowledge.ts).
 */
import type {
  KnowledgeArticleStatus,
  KnowledgeAudience,
  KnowledgeCategory,
  KnowledgeSourceType,
  KnowledgeTranslationStatus,
  Language,
} from "../../src/generated/prisma/client.js";

export type KnowledgeSourceContent = {
  /** Natural key: one record per document. */
  url: string;
  publisher: string;
  title: string;
  sourceType: KnowledgeSourceType;
  originalLanguage: Language;
  /** Publication date stated by the source ("YYYY-MM-DD"), or null if the source gives none. */
  publishedOn: string | null;
  retrievedAt: string;
  lastVerifiedAt: string;
  nextReviewAt: string;
};

export type KnowledgeTranslationContent = {
  title: string;
  summary: string;
  body: string;
  keywords: string[];
  translationStatus: KnowledgeTranslationStatus;
};

export type KnowledgeArticleContent = {
  /** Natural key. */
  slug: string;
  category: KnowledgeCategory;
  status: KnowledgeArticleStatus;
  audience: KnowledgeAudience;
  /** URL of the source in `knowledgeSources`. */
  sourceUrl: string;
  sourceSection: string;
  isTimeSensitive: boolean;
  lastReviewedAt: string;
  nextReviewAt: string;
  /** EN is required and canonical; SI and TA are optional translations of it. */
  translations: { EN: KnowledgeTranslationContent } & Partial<
    Record<"SI" | "TA", KnowledgeTranslationContent>
  >;
};

const CBSL = "Central Bank of Sri Lanka";
const VERIFIED_AT = "2026-09-26T08:00:00.000Z";
const NEXT_YEARLY_REVIEW = "2027-09-26T08:00:00.000Z";
const BE_SCAM_PROOF_RECHECKED_AT = "2026-09-26T09:20:00.000Z";
/** Time-sensitive facts (amounts, limits) are re-checked every 3 months. */
const NEXT_QUARTERLY_REVIEW = "2026-12-26T08:00:00.000Z";

const URL = {
  curriculum:
    "https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/publications/otherpub/financial_literacy_curriculum_e.pdf",
  roadmap:
    "https://www.cbsl.gov.lk/en/news/central-bank-launches-financial-literacy-roadmap-of-sri-lanka-2024-2028",
  consumerRelations: "https://www.cbsl.gov.lk/en/fcrd",
  beScamProof: "https://www.cbsl.gov.lk/en/be-scam-proof",
  protectPasswords:
    "https://www.cbsl.gov.lk/en/news/beware-of-online-scams-protect-your-bank-passwords-and-pin",
  safePayments:
    "https://www.cbsl.gov.lk/en/news/Adopting-Safe-and-Secure-Electronic-Payment-Practices",
  depositInsurance: "https://www.cbsl.gov.lk/en/sri-lanka-deposit-insurance-scheme",
} as const;

function cbslSource(
  url: string,
  title: string,
  publishedOn: string | null,
  nextReviewAt = NEXT_YEARLY_REVIEW,
): KnowledgeSourceContent {
  return {
    url,
    publisher: CBSL,
    title,
    sourceType: "OFFICIAL_REGULATOR",
    originalLanguage: "EN",
    publishedOn,
    retrievedAt: VERIFIED_AT,
    lastVerifiedAt: VERIFIED_AT,
    nextReviewAt,
  };
}

export const knowledgeSources: readonly KnowledgeSourceContent[] = [
  cbslSource(URL.curriculum, "Financial Literacy Curriculum", null),
  cbslSource(
    URL.roadmap,
    "Central Bank Launches Financial Literacy Roadmap of Sri Lanka 2024-2028",
    "2024-05-21",
  ),
  cbslSource(URL.consumerRelations, "Financial Consumer Relations Department (FCRD)", null),
  // Re-read on 26 September 2026 (campaign page, posters and linked publications) for the
  // suspicious-activity article.
  {
    ...cbslSource(URL.beScamProof, "Be Scam Proof", null),
    retrievedAt: BE_SCAM_PROOF_RECHECKED_AT,
    lastVerifiedAt: BE_SCAM_PROOF_RECHECKED_AT,
  },
  cbslSource(
    URL.protectPasswords,
    "Beware of Online Scams - Protect Your Bank Passwords and PINs",
    "2019-11-21",
  ),
  cbslSource(
    URL.safePayments,
    "Adopting Safe and Secure Electronic Payment Practices",
    "2019-08-01",
  ),
  cbslSource(
    URL.depositInsurance,
    "Sri Lanka Deposit Insurance Scheme",
    null,
    NEXT_QUARTERLY_REVIEW,
  ),
];

function article(
  fields: Omit<
    KnowledgeArticleContent,
    "status" | "audience" | "lastReviewedAt" | "nextReviewAt" | "isTimeSensitive"
  > &
    Partial<Pick<KnowledgeArticleContent, "isTimeSensitive" | "nextReviewAt" | "audience">>,
): KnowledgeArticleContent {
  return {
    status: "PUBLISHED",
    audience: "GENERAL_PUBLIC",
    isTimeSensitive: false,
    lastReviewedAt: VERIFIED_AT,
    nextReviewAt: NEXT_YEARLY_REVIEW,
    ...fields,
  };
}

/**
 * All seeded text is FinVoice's own plain-language wording of the source (English), or a
 * translation of that wording (Sinhala, Tamil). None of it is the source's official text, and it
 * was drafted with machine assistance, so it is MACHINE_ASSISTED until a qualified person reviews it
 * and the status is changed to HUMAN_REVIEWED.
 */
function text(
  title: string,
  summary: string,
  body: string,
  keywords: string[],
): KnowledgeTranslationContent {
  return { title, summary, body, keywords, translationStatus: "MACHINE_ASSISTED" };
}

export const knowledgeArticles: readonly KnowledgeArticleContent[] = [
  article({
    slug: "why-saving-matters",
    category: "SAVING",
    sourceUrl: URL.curriculum,
    sourceSection: "Chapter 3, Personal Financial Management: Importance of Saving",
    translations: {
      EN: text(
        "Why saving matters",
        "Saving helps you pay for unexpected costs without falling into debt, and helps you reach your goals.",
        [
          "Life is unpredictable. Something you did not plan for, for example an illness, losing a job or a sudden repair, can bring extra costs.",
          "Money you have saved helps you pay for these costs without falling into debt.",
          "Saving also helps you reach your goals, for example:\n- a child's education\n- repairing or buying a home\n- paying off a debt",
          "Start by setting clear saving goals. For each goal, decide how much money you need and by when.",
        ].join("\n\n"),
        ["saving", "savings", "save", "goals", "debt", "unexpected"],
      ),
      SI: text(
        "ඉතිරි කිරීම වැදගත් වන්නේ ඇයි",
        "ඉතිරි කිරීම, ණයට වැටීමෙන් තොරව අනපේක්ෂිත වියදම් දැරීමට සහ ඔබේ ඉලක්ක සපුරා ගැනීමට උපකාරී වේ.",
        [
          "ජීවිතය අනපේක්ෂිතය. ඔබ සැලසුම් නොකළ දෙයක්, උදාහරණයක් ලෙස රෝගයක්, රැකියාව අහිමි වීමක් හෝ හදිසි අලුත්වැඩියාවක්, අමතර වියදම් ඇති කළ හැකිය.",
          "ඔබ ඉතිරි කළ මුදල්, ණයට වැටීමෙන් තොරව මෙම වියදම් දැරීමට උපකාරී වේ.",
          "ඉතිරි කිරීම ඔබේ ඉලක්ක සපුරා ගැනීමටද උපකාරී වේ, උදාහරණ ලෙස:\n- දරුවෙකුගේ අධ්‍යාපනය\n- නිවසක් අලුත්වැඩියා කිරීම හෝ මිලදී ගැනීම\n- ණයක් ගෙවා නිම කිරීම",
          "පැහැදිලි ඉතිරි කිරීමේ ඉලක්ක තබා ගැනීමෙන් ආරම්භ කරන්න. සෑම ඉලක්කයක් සඳහාම ඔබට කොපමණ මුදලක් අවශ්‍යද සහ කවදා වන විටද යන්න තීරණය කරන්න.",
        ].join("\n\n"),
        ["ඉතිරි කිරීම", "ඉතිරිකිරීම්", "ඉලක්ක", "ණය"],
      ),
      TA: text(
        "சேமிப்பு ஏன் முக்கியம்",
        "கடனில் சிக்காமல் எதிர்பாராத செலவுகளைச் சமாளிக்கவும், உங்கள் இலக்குகளை அடையவும் சேமிப்பு உதவுகிறது.",
        [
          "வாழ்க்கை எதிர்பாராதது. நீங்கள் திட்டமிடாத ஒன்று, உதாரணமாக நோய், வேலை இழப்பு அல்லது திடீர் பழுதுபார்ப்பு, கூடுதல் செலவுகளை ஏற்படுத்தலாம்.",
          "நீங்கள் சேமித்த பணம், கடனில் சிக்காமல் இந்தச் செலவுகளைச் சமாளிக்க உதவுகிறது.",
          "சேமிப்பு உங்கள் இலக்குகளை அடையவும் உதவுகிறது, உதாரணமாக:\n- பிள்ளையின் கல்வி\n- வீட்டைப் பழுதுபார்த்தல் அல்லது வாங்குதல்\n- கடனை முழுமையாகத் திருப்பிச் செலுத்துதல்",
          "தெளிவான சேமிப்பு இலக்குகளை அமைப்பதன் மூலம் தொடங்குங்கள். ஒவ்வொரு இலக்கிற்கும் உங்களுக்கு எவ்வளவு பணம் தேவை, எப்போதுக்குள் தேவை என்பதைத் தீர்மானியுங்கள்.",
        ].join("\n\n"),
        ["சேமிப்பு", "இலக்குகள்", "கடன்"],
      ),
    },
  }),

  article({
    slug: "simple-budget",
    category: "BUDGETING",
    sourceUrl: URL.curriculum,
    sourceSection:
      "Chapter 3, Personal Financial Management: Step 2, Develop your budget; 3.8 Personal Budgeting (examples of income and expense categories)",
    translations: {
      EN: text(
        "How to make a simple budget",
        "Know how much money comes in each month, list everything you spend, and look for costs you can reduce.",
        [
          "Making a budget is one of the steps to saving well.",
          "Step 1: Know your income. Write down how much money you earn each month. Some income is fixed, like a salary or a pension. Some income changes, like overtime pay or part-time work.",
          "Step 2: List all your expenses.\n- Fixed expenses are about the same each month, like rent, loan instalments and insurance.\n- Variable expenses change from month to month, like food, fuel, medical costs and clothing.",
          "Step 3: Look for ways to save. Find expenses you can reduce, and spending you do not need.",
        ].join("\n\n"),
        ["budget", "budgeting", "income", "expenses", "fixed", "variable", "saving"],
      ),
    },
  }),

  article({
    slug: "emergency-savings",
    category: "SAVING",
    sourceUrl: URL.curriculum,
    sourceSection:
      "Chapter 3, Personal Financial Management: Step 3, Plan your emergency fund; Tips to Avoid Debt and Safe Borrowing",
    translations: {
      EN: text(
        "Building emergency savings",
        "An emergency fund is money kept aside for sudden costs. Give it priority, and start small if you need to.",
        [
          "An emergency fund is money you keep aside for sudden, unexpected costs.",
          "Give your emergency fund priority when you plan your savings.",
          "A common guide is to save enough to cover 3 to 6 months of your living expenses. Keep this money in a savings account you can use quickly when you need it.",
          "You do not need to save it all at once:\n- Start with a small amount, and increase it as your income allows.\n- Keep a separate savings account for your emergency fund.\n- You can set up an automatic transfer, for example a standing order, so that you save regularly.",
          "An emergency fund can help you avoid costly loans when something unexpected happens.",
        ].join("\n\n"),
        ["emergency", "emergency fund", "saving", "savings", "unexpected"],
      ),
    },
  }),

  article({
    slug: "responsible-borrowing",
    category: "BORROWING",
    sourceUrl: URL.consumerRelations,
    sourceSection: "Financial consumer responsibilities",
    translations: {
      EN: text(
        "Borrowing responsibly",
        "Only borrow what you can afford to repay, and do not let your repayments fall behind.",
        [
          "The Central Bank of Sri Lanka lists these among the responsibilities of financial consumers:\n- Do not borrow more than you can afford to repay.\n- Do not let your repayments or instalments fall into arrears (become overdue).\n- Understand the terms of a loan before you agree to it.\n- Give the lender accurate and up-to-date information.",
          "Before you borrow, compare the repayment with the amount you can afford to pay each month.",
        ].join("\n\n"),
        ["borrowing", "loan", "loans", "repayment", "arrears", "debt"],
      ),
    },
  }),

  article({
    slug: "understand-terms-before-agreeing",
    category: "CONSUMER_PROTECTION",
    sourceUrl: URL.consumerRelations,
    sourceSection: "Financial consumer rights and responsibilities",
    translations: {
      EN: text(
        "Understand the terms before you agree",
        "Before you sign up for a loan, account or other financial product, make sure you understand what you are agreeing to.",
        [
          "Before you take a financial product, such as a loan, a savings account or a card, make sure you understand what you are agreeing to and what you will need to pay.",
          "You have a right to receive information that is complete, clear, short, accurate and not misleading. If something is not clear, ask before you sign.",
          "Understanding the terms before you enter an agreement is also one of your responsibilities as a financial consumer. Once you agree, you need to keep to the agreement.",
        ].join("\n\n"),
        ["terms", "conditions", "agreement", "contract", "information", "rights"],
      ),
    },
  }),

  article({
    slug: "protect-pin-otp-passwords",
    category: "DIGITAL_FINANCE",
    audience: "LOW_DIGITAL_LITERACY",
    sourceUrl: URL.protectPasswords,
    sourceSection: "Press notice, 21 November 2019",
    translations: {
      EN: text(
        "Keep your PIN, OTP and passwords secret",
        "Never share your PIN, one-time password (OTP), passwords or card details with anyone.",
        [
          "Your PIN, passwords and one-time passwords (OTPs) protect your money. The Central Bank of Sri Lanka advises that they must be used only by the person who owns the account.",
          "Never share these with anyone:\n- your account username and password\n- your PIN\n- an OTP sent to your phone\n- your card number, expiry date or the security code on the back of the card (CVV)",
          "Fraudsters may offer an easy loan and then ask for these details during a fake approval process. They use them to get into your account and take your money.",
          "If someone asks you for this information, tell your bank or financial institution immediately.",
        ].join("\n\n"),
        ["pin", "otp", "password", "passwords", "cvv", "card", "fraud", "scam"],
      ),
      SI: text(
        "ඔබේ PIN අංකය, OTP සහ මුරපද රහසිගතව තබා ගන්න",
        "ඔබේ PIN අංකය, එක් වරක් භාවිත මුරපදය (OTP), මුරපද හෝ කාඩ්පත් විස්තර කිසිවෙකුටත් ලබා නොදෙන්න.",
        [
          "ඔබේ PIN අංකය, මුරපද සහ එක් වරක් භාවිත මුරපද (OTP) ඔබේ මුදල් ආරක්ෂා කරයි. ඒවා භාවිත කළ යුත්තේ ගිණුමේ හිමිකරු පමණක් බව ශ්‍රී ලංකා මහ බැංකුව උපදෙස් දෙයි.",
          "මේවා කිසිවෙකුටත් ලබා නොදෙන්න:\n- ඔබේ ගිණුමේ පරිශීලක නාමය සහ මුරපදය\n- ඔබේ PIN අංකය\n- ඔබේ දුරකථනයට එවන OTP අංකය\n- ඔබේ කාඩ්පත් අංකය, කල් ඉකුත් වන දිනය හෝ කාඩ්පතේ පිටුපස ඇති ආරක්ෂක කේතය (CVV)",
          "වංචාකරුවන් පහසු ණයක් පිරිනමා, ව්‍යාජ අනුමත කිරීමේ ක්‍රියාවලියක් අතරතුර මෙම විස්තර ඉල්ලා සිටිය හැකිය. ඔවුන් ඒවා භාවිත කර ඔබේ ගිණුමට ඇතුළු වී ඔබේ මුදල් ලබා ගනී.",
          "යමෙක් ඔබෙන් මෙම තොරතුරු ඉල්ලා සිටියහොත්, වහාම ඔබේ බැංකුවට හෝ මූල්‍ය ආයතනයට දන්වන්න.",
        ].join("\n\n"),
        ["pin", "otp", "මුරපදය", "කාඩ්පත", "වංචා"],
      ),
      TA: text(
        "உங்கள் PIN, OTP மற்றும் கடவுச்சொற்களை இரகசியமாக வைத்திருங்கள்",
        "உங்கள் PIN, ஒருமுறை கடவுச்சொல் (OTP), கடவுச்சொற்கள் அல்லது அட்டை விவரங்களை யாருடனும் பகிர வேண்டாம்.",
        [
          "உங்கள் PIN, கடவுச்சொற்கள் மற்றும் ஒருமுறை கடவுச்சொற்கள் (OTP) உங்கள் பணத்தைப் பாதுகாக்கின்றன. அவற்றைக் கணக்கின் உரிமையாளர் மட்டுமே பயன்படுத்த வேண்டும் என்று இலங்கை மத்திய வங்கி அறிவுறுத்துகிறது.",
          "இவற்றை யாருடனும் பகிர வேண்டாம்:\n- உங்கள் கணக்கின் பயனர் பெயர் மற்றும் கடவுச்சொல்\n- உங்கள் PIN\n- உங்கள் தொலைபேசிக்கு அனுப்பப்படும் OTP\n- உங்கள் அட்டை எண், காலாவதித் திகதி அல்லது அட்டையின் பின்புறத்தில் உள்ள பாதுகாப்புக் குறியீடு (CVV)",
          "மோசடிக்காரர்கள் எளிதான கடன் ஒன்றை வழங்குவதாகக் கூறி, போலியான அங்கீகார நடைமுறையின்போது இந்த விவரங்களைக் கேட்கலாம். அவற்றைப் பயன்படுத்தி உங்கள் கணக்கிற்குள் நுழைந்து உங்கள் பணத்தை எடுத்துக்கொள்கிறார்கள்.",
          "யாராவது இந்தத் தகவல்களைக் கேட்டால், உடனடியாக உங்கள் வங்கிக்கு அல்லது நிதி நிறுவனத்திற்குத் தெரிவியுங்கள்.",
        ].join("\n\n"),
        ["pin", "otp", "கடவுச்சொல்", "அட்டை", "மோசடி"],
      ),
    },
  }),

  article({
    slug: "recognise-scams",
    category: "SCAMS",
    sourceUrl: URL.beScamProof,
    sourceSection: "Be Scam Proof public awareness initiative",
    translations: {
      EN: text(
        "How to recognise a scam",
        "Scammers use false promises, pretend to be someone else, or offer fake investments to get your money or personal details.",
        [
          "Scammers try to get your money or your personal information. They use methods such as:\n- getting into your devices or accounts without permission\n- misleading promises\n- pretending to be someone you trust\n- fake investment schemes",
          "The Central Bank of Sri Lanka's Be Scam Proof campaign gives four simple rules:\n- Stay alert.\n- Question unrealistic returns.\n- Protect your credentials, such as your passwords and PINs.\n- Check before you act.",
        ].join("\n\n"),
        ["scam", "scams", "fraud", "investment", "impersonation", "returns"],
      ),
      SI: text(
        "වංචාවක් හඳුනා ගන්නේ කෙසේද",
        "වංචාකරුවන් ඔබේ මුදල් හෝ පුද්ගලික තොරතුරු ලබා ගැනීමට බොරු පොරොන්දු, වෙනත් අයෙකු ලෙස පෙනී සිටීම හෝ ව්‍යාජ ආයෝජන යෝජනා භාවිත කරයි.",
        [
          "වංචාකරුවන් ඔබේ මුදල් හෝ පුද්ගලික තොරතුරු ලබා ගැනීමට උත්සාහ කරයි. ඔවුන් මෙවැනි ක්‍රම භාවිත කරයි:\n- අවසරයකින් තොරව ඔබේ උපාංගවලට හෝ ගිණුම්වලට ඇතුළු වීම\n- නොමඟ යවන පොරොන්දු\n- ඔබ විශ්වාස කරන අයෙකු ලෙස පෙනී සිටීම\n- ව්‍යාජ ආයෝජන යෝජනා ක්‍රම",
          "ශ්‍රී ලංකා මහ බැංකුවේ Be Scam Proof වැඩසටහන සරල නීති හතරක් ලබා දෙයි:\n- අවදියෙන් සිටින්න.\n- යථාර්ථවාදී නොවන ප්‍රතිලාභ ගැන ප්‍රශ්න කරන්න.\n- ඔබේ මුරපද සහ PIN අංක වැනි පිවිසුම් තොරතුරු ආරක්ෂා කරන්න.\n- ක්‍රියා කිරීමට පෙර පරීක්ෂා කරන්න.",
        ].join("\n\n"),
        ["වංචා", "වංචාව", "ආයෝජන"],
      ),
      TA: text(
        "மோசடியை எவ்வாறு அடையாளம் காண்பது",
        "உங்கள் பணத்தையோ தனிப்பட்ட தகவல்களையோ பெற மோசடிக்காரர்கள் பொய்யான வாக்குறுதிகள், வேறொருவர் போல நடித்தல் அல்லது போலி முதலீட்டுத் திட்டங்களைப் பயன்படுத்துகிறார்கள்.",
        [
          "மோசடிக்காரர்கள் உங்கள் பணத்தையோ தனிப்பட்ட தகவல்களையோ பெற முயல்கிறார்கள். அவர்கள் இது போன்ற முறைகளைப் பயன்படுத்துகிறார்கள்:\n- அனுமதியின்றி உங்கள் சாதனங்கள் அல்லது கணக்குகளுக்குள் நுழைதல்\n- தவறாக வழிநடத்தும் வாக்குறுதிகள்\n- நீங்கள் நம்பும் ஒருவர் போல நடித்தல்\n- போலி முதலீட்டுத் திட்டங்கள்",
          "இலங்கை மத்திய வங்கியின் Be Scam Proof திட்டம் நான்கு எளிய விதிகளை வழங்குகிறது:\n- விழிப்புடன் இருங்கள்.\n- நம்பமுடியாத அளவு அதிக வருமானங்கள் குறித்துக் கேள்வி எழுப்புங்கள்.\n- உங்கள் கடவுச்சொற்கள், PIN போன்ற உள்நுழைவு விவரங்களைப் பாதுகாத்துக்கொள்ளுங்கள்.\n- செயல்படுவதற்கு முன் சரிபாருங்கள்.",
        ].join("\n\n"),
        ["மோசடி", "முதலீடு"],
      ),
    },
  }),

  article({
    slug: "report-suspicious-activity",
    category: "SCAMS",
    sourceUrl: URL.beScamProof,
    // Every statement comes from Be Scam Proof campaign material: the two posters (steps and warning
    // signs) and the FIU booklet published on the same page (reporting a scam to the police and
    // the bank). The page gives no hotline numbers or other contact details, so none are stated.
    sourceSection:
      "Posters 'Don't Recognize a Transaction? Don't Ignore It!' and 'Your password and PIN are like your toothbrush!'; FIU booklet 'Financial Scams: The Hell Underneath The Heaven' (December 2023), page 18",
    translations: {
      EN: text(
        "What to do if you notice suspicious activity",
        "If you see a transaction you did not make, or someone asks for your PIN, password or OTP, act immediately: contact your bank and protect your account.",
        [
          "Watch for warning signs, such as:\n- payments or transfers that you did not make\n- transaction alerts that you do not recognise\n- a request to confirm or approve a transaction that you do not recognise\n- an OTP or payment confirmation for a transaction that you did not start",
          "If something looks suspicious:\n- Contact your bank immediately.\n- Suspend your card so it cannot be used for more transactions.\n- Change your login details, such as your password and PIN.\n- Check your account activity immediately.",
          "Never share your PIN, password or OTP. No bank or trusted authority will ever ask for them. Be careful with calls, messages or emails that ask you to confirm a payment.",
          "If you have become a victim of a financial scam, make a complaint at the nearest police station as soon as possible. If a bank account is involved, also report it to the bank.",
        ].join("\n\n"),
        ["suspicious", "fraud", "report", "transaction", "scam", "police", "bank", "otp"],
      ),
    },
  }),

  article({
    slug: "consumer-rights-and-complaints",
    category: "CONSUMER_PROTECTION",
    sourceUrl: URL.consumerRelations,
    sourceSection: "Financial consumer rights and responsibilities; complaint handling",
    translations: {
      EN: text(
        "Your rights as a financial consumer, and how to complain",
        "You have the right to fair treatment, clear information and privacy. If you have a problem, complain to the financial institution first.",
        [
          "The Central Bank of Sri Lanka lists these rights of financial consumers:\n- to be treated fairly by financial service providers\n- to complain, and to get a satisfactory answer within a reasonable time\n- to have your financial information kept private and confidential\n- to have access to suitable financial products and services\n- to receive information that is complete, clear, short, accurate and not misleading",
          "If you have a complaint:\n- First, complain to the financial institution concerned.\n- If you are not satisfied with its answer, you can take your complaint to the Central Bank's Financial Consumer Relations Department (FCRD).",
          "You also have responsibilities, such as understanding the terms before you agree, giving accurate information and taking care in every transaction.",
        ].join("\n\n"),
        ["rights", "complaint", "complaints", "fcrd", "consumer protection", "privacy"],
      ),
    },
  }),

  article({
    slug: "deposit-insurance",
    category: "DEPOSIT_PROTECTION",
    sourceUrl: URL.depositInsurance,
    sourceSection: "Sri Lanka Deposit Insurance Scheme: coverage and member institutions",
    isTimeSensitive: true,
    nextReviewAt: NEXT_QUARTERLY_REVIEW,
    translations: {
      EN: text(
        "Deposit insurance in Sri Lanka",
        "The Sri Lanka Deposit Insurance Scheme protects deposits up to Rs. 1,100,000 per depositor, per institution, if a member institution fails.",
        [
          "The Sri Lanka Deposit Insurance Scheme (SLDIS) protects depositors if a member financial institution fails. Insured depositors are paid compensation, up to a maximum amount.",
          "The current coverage is up to Rs. 1,100,000 per depositor, per institution.",
          "All licensed commercial banks, licensed specialised banks and licensed finance companies are registered as member institutions.",
          "To work out the compensation, a depositor's insured deposits in Sri Lankan rupees and in foreign currencies are added together.",
          "This amount can change. Check the Central Bank of Sri Lanka's website for the latest information.",
        ].join("\n\n"),
        ["deposit insurance", "sldis", "deposits", "compensation", "bank", "finance company"],
      ),
    },
  }),

  article({
    slug: "safe-digital-payments",
    category: "DIGITAL_FINANCE",
    audience: "LOW_DIGITAL_LITERACY",
    sourceUrl: URL.safePayments,
    sourceSection: "Press notice, 1 August 2019",
    translations: {
      EN: text(
        "Staying safe with digital payments",
        "Be careful with any information that can be used to get into your accounts or cards, and register for real-time payment alerts.",
        [
          "When you use mobile banking, internet banking, payment cards or e-wallets, be careful with any information that someone could use to get into your accounts, cards or e-wallet.",
          "Be careful about sharing your account numbers, card details (including the expiry date and CVV number) and your NIC number.",
          "Never share your passwords, PINs, OTPs or any other information used to confirm a transaction. Use them only for their purpose.",
          "The Central Bank of Sri Lanka also advises you to:\n- register for real-time payment alerts, such as SMS alerts, from your bank or financial institution\n- get an EMV chip-based payment card, which has security features designed to prevent card fraud",
        ].join("\n\n"),
        [
          "digital payments",
          "mobile banking",
          "internet banking",
          "card",
          "e-wallet",
          "sms alerts",
          "otp",
          "pin",
        ],
      ),
    },
  }),

  article({
    slug: "why-financial-literacy-matters",
    category: "GENERAL_FINANCIAL_LITERACY",
    sourceUrl: URL.roadmap,
    sourceSection: "Launch announcement, 21 May 2024",
    translations: {
      EN: text(
        "Why financial literacy matters",
        "Understanding money helps you make informed decisions and use financial products wisely.",
        [
          "Being financially literate helps you make informed decisions about your money and about financial products.",
          "In May 2024, the Central Bank of Sri Lanka launched the Financial Literacy Roadmap of Sri Lanka (2024-2028). Its aims include:\n- improving how people in Sri Lanka manage their money\n- helping people become more financially resilient\n- encouraging informed and responsible use of financial products\n- supporting financial inclusion and consumer protection",
          "Learning the basics, such as saving, budgeting, borrowing carefully and avoiding scams, is a good place to start.",
        ].join("\n\n"),
        ["financial literacy", "roadmap", "decisions", "financial inclusion"],
      ),
    },
  }),
];
