import { describe, expect, it } from "vitest";

import { INDICATOR_CODES, RULES, type RuleLanguage } from "../src/index.js";
import { analyze, codesOf, evidenceOf } from "./helpers.js";

const ZWJ = String.fromCharCode(0x200d);

describe("Sinhala", () => {
  it.each([
    ["ඔබේ OTP අංකය අපට එවන්න.", "CREDENTIAL_REQUEST"],
    ["කරුණාකර ඔබේ මුරපදය කියන්න.", "CREDENTIAL_REQUEST"],
    ["ඔබේ පින් අංකය දෙන්න.", "CREDENTIAL_REQUEST"],
    ["වහාම පිළිතුරු දෙන්න, නැත්නම් ඔබේ ගිණුම අවහිර කරනු ලැබේ.", "URGENCY_PRESSURE"],
    ["මම නොකළ ගනුදෙනුවක් මගේ ගිණුමේ තියෙනවා.", "UNKNOWN_TRANSACTION"],
    ["අපේ ආයෝජනයෙන් සහතික ලාභ ලැබේ.", "UNREALISTIC_RETURN"],
    ["ඔබ ලොතරැයියක් දිනා ඇත.", "UNSOLICITED_OFFER"],
    ["ත්‍යාගය ලබා ගැනීමට පළමුව ගාස්තුවක් ගෙවන්න.", "ADVANCE_PAYMENT"],
    ["රු. 5000 මෙම ගිණුමට දමන්න.", "PAYMENT_TRANSFER_REQUEST"],
  ])("%s → %s", (content, code) => {
    const result = analyze(content, "SI");
    expect(codesOf(result)).toContain(code);
    expect(result.analysisLanguage).toBe("SI");
    expect(result.languageCoverage).toBe("PARTIAL");
  });

  it("detects the strongest combined pattern as HIGH", () => {
    const result = analyze("ඔබේ OTP අංකය අපට එවන්න. ඔබේ ගිණුම අවහිර කරනු ලැබේ.", "SI");
    expect(result.riskLevel).toBe("HIGH");
    expect(evidenceOf(result, "CREDENTIAL_REQUEST")).toEqual(["OTP අංකය අපට එවන්න"]);
  });

  it("does not treat Sinhala warnings as requests", () => {
    for (const content of [
      "ඔබේ OTP අංකය කිසිවෙකුටත් ලබා නොදෙන්න.",
      "OTP එක කාටවත් දෙන්න එපා.",
      "ඔබේ PIN අංකය, එක් වරක් භාවිත මුරපදය (OTP), මුරපද හෝ කාඩ්පත් විස්තර කිසිවෙකුටත් ලබා නොදෙන්න.",
    ]) {
      expect(codesOf(analyze(content, "SI")), content).not.toContain("CREDENTIAL_REQUEST");
    }
  });

  it("keeps a request inside one sentence (full stop between object and verb)", () => {
    expect(codesOf(analyze("මට OTP එකක් ආවා. ඊට පස්සේ මම අම්මට කිව්වා.", "SI"))).toEqual([]);
  });
});

describe("Tamil", () => {
  it.each([
    ["உங்கள் OTP ஐ உடனடியாக அனுப்புங்கள்.", "CREDENTIAL_REQUEST"],
    ["உங்கள் கடவுச்சொல்லைச் சொல்லுங்கள்.", "CREDENTIAL_REQUEST"],
    ["உங்கள் பின் எண்ணைத் தாருங்கள்.", "CREDENTIAL_REQUEST"],
    ["உடனடியாக பதில் அனுப்பவும், இல்லையெனில் உங்கள் கணக்கு முடக்கப்படும்.", "URGENCY_PRESSURE"],
    ["நான் செய்யாத பரிவர்த்தனை ஒன்று என் கணக்கில் உள்ளது.", "UNKNOWN_TRANSACTION"],
    ["இந்த முதலீட்டில் உத்தரவாத லாபம் கிடைக்கும்.", "UNREALISTIC_RETURN"],
    ["நீங்கள் லாட்டரியில் பரிசு வென்றுள்ளீர்கள்.", "UNSOLICITED_OFFER"],
    ["பரிசைப் பெற முதலில் கட்டணம் செலுத்த வேண்டும்.", "ADVANCE_PAYMENT"],
    ["ரூ. 5000 பணத்தை இந்தக் கணக்கிற்கு அனுப்புங்கள்.", "PAYMENT_TRANSFER_REQUEST"],
  ])("%s → %s", (content, code) => {
    const result = analyze(content, "TA");
    expect(codesOf(result)).toContain(code);
    expect(result.analysisLanguage).toBe("TA");
    expect(result.languageCoverage).toBe("PARTIAL");
  });

  it("does not treat Tamil warnings or hypotheticals as requests", () => {
    for (const content of [
      "உங்கள் OTP ஐ யாருடனும் பகிர வேண்டாம்.",
      "உங்கள் PIN, ஒருமுறை கடவுச்சொல் (OTP), கடவுச்சொற்கள் அல்லது அட்டை விவரங்களை யாருடனும் பகிர வேண்டாம்.",
      "யாராவது உங்கள் OTP ஐக் கேட்டால், உடனடியாக உங்கள் வங்கிக்குத் தெரிவியுங்கள்.",
    ]) {
      expect(codesOf(analyze(content, "TA")), content).not.toContain("CREDENTIAL_REQUEST");
    }
  });
});

describe("normalization and mixed language", () => {
  it("applies Unicode NFKC normalization (composed Tamil vowel signs, full-width Latin)", () => {
    // "கொடுங்கள்" (give) written with the decomposed vowel sign (U+0BC6 U+0BBE).
    const decomposed = `உங்கள் PIN ஐ க${String.fromCharCode(0x0bc6, 0x0bbe)}டுங்கள்.`;
    expect(decomposed).not.toBe(decomposed.normalize("NFKC"));
    expect(codesOf(analyze(decomposed, "TA"))).toContain("CREDENTIAL_REQUEST");
    // Evidence keeps the original (decomposed) characters.
    expect(evidenceOf(analyze(decomposed, "TA"), "CREDENTIAL_REQUEST")[0]).toContain(
      String.fromCharCode(0x0bc6, 0x0bbe),
    );
    expect(codesOf(analyze("Ｓｅｎｄ ｍｅ ｙｏｕｒ ＯＴＰ", "EN"))).toEqual(["CREDENTIAL_REQUEST"]);
  });

  it("ignores Sinhala zero-width joiners when matching, and keeps them in evidence", () => {
    const content = `අපේ ආයෝජනයෙන් සහතික ප්${ZWJ}රතිලාභ ලැබේ.`;
    const result = analyze(content, "SI");
    expect(codesOf(result)).toContain("UNREALISTIC_RETURN");
    expect(evidenceOf(result, "UNREALISTIC_RETURN")[0]).toContain(ZWJ);
  });

  it("handles Sinhala and Tamil text with typographic punctuation", () => {
    expect(codesOf(analyze("“ඔබේ OTP අංකය අපට එවන්න!”", "SI"))).toContain("CREDENTIAL_REQUEST");
    expect(codesOf(analyze("‘உங்கள் OTP ஐ அனுப்புங்கள்’ — என்று கூறினார்.", "TA"))).toContain(
      "CREDENTIAL_REQUEST",
    );
  });

  it("detects English financial terms inside Sinhala and Tamil sentences", () => {
    expect(codesOf(analyze("ඔබේ bank account number එක එවන්න.", "SI"))).toContain(
      "PERSONAL_INFORMATION_REQUEST",
    );
    expect(codesOf(analyze("ඔයාගේ OTP එක send කරන්න.", "SI"))).toContain("CREDENTIAL_REQUEST");
    expect(codesOf(analyze("உங்க card number ஐ அனுப்புங்கள்.", "TA"))).toContain(
      "PERSONAL_INFORMATION_REQUEST",
    );
    expect(codesOf(analyze("உங்க OTP ஐ send பண்ணுங்க.", "TA"))).toContain("CREDENTIAL_REQUEST");
  });

  it("detects English requests inside mixed-language content, whatever the declared language", () => {
    const result = analyze("ආයුබෝවන්! Please send your OTP now.", "EN");
    expect(codesOf(result)).toContain("CREDENTIAL_REQUEST");
    // Declared EN, but the content contains Sinhala: coverage is reported honestly.
    expect(result.languageCoverage).toBe("PARTIAL");
    expect(analyze("Please send your OTP now.", "EN").languageCoverage).toBe("FULL");
  });

  it("detects language-neutral link signals in any language", () => {
    const result = analyze("මෙම ලින්ක් එක ක්ලික් කරන්න: bit.ly/abc", "SI");
    expect(codesOf(result)).toContain("SUSPICIOUS_LINK");
  });
});

describe("rule coverage per language", () => {
  function coveredBy(language: RuleLanguage) {
    return new Set(
      RULES.filter((rule) => rule.languages.includes(language)).map((rule) => rule.indicator),
    );
  }

  it("English has patterns for every indicator", () => {
    expect([...coveredBy("EN")].sort()).toEqual([...INDICATOR_CODES].sort());
  });

  it("Sinhala and Tamil cover the strongest indicators (and are still reported as PARTIAL)", () => {
    for (const language of ["SI", "TA"] as const) {
      const covered = coveredBy(language);
      for (const code of [
        "CREDENTIAL_REQUEST",
        "URGENCY_PRESSURE",
        "UNKNOWN_TRANSACTION",
        "UNREALISTIC_RETURN",
        "ADVANCE_PAYMENT",
        "PAYMENT_TRANSFER_REQUEST",
        "PERSONAL_INFORMATION_REQUEST",
      ] as const) {
        expect(covered.has(code), `${language} ${code}`).toBe(true);
      }
    }
  });
});
