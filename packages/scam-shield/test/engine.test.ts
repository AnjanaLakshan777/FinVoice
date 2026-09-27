import { describe, expect, it } from "vitest";

import {
  analyzeScam,
  MAX_CONTENT_LENGTH,
  MAX_INDICATORS,
  MAX_SNIPPET_LENGTH,
  MAX_SNIPPETS_PER_INDICATOR,
  RULESET_VERSION,
  ScamShieldInputError,
  type IndicatorStrength,
} from "../src/index.js";
import { classifyRisk } from "../src/risk/classify.js";
import { analyze, codesOf, evidenceOf, indicatorOf } from "./helpers.js";

function issuesOf(input: unknown): (string | null)[] {
  try {
    analyzeScam(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ScamShieldInputError);
    return (error as ScamShieldInputError).issues.map((issue) => issue.field);
  }
  throw new Error("Expected a ScamShieldInputError");
}

describe("input validation", () => {
  it("1. rejects empty and whitespace-only content", () => {
    expect(issuesOf({ content: "", language: "EN", sourceType: "MESSAGE" })).toEqual(["content"]);
    expect(issuesOf({ content: "   \n\t ", language: "EN", sourceType: "MESSAGE" })).toEqual([
      "content",
    ]);
    expect(issuesOf({ language: "EN", sourceType: "MESSAGE" })).toEqual(["content"]);
  });

  it("2. rejects oversized content (after trimming), and accepts the maximum", () => {
    const max = "a".repeat(MAX_CONTENT_LENGTH);
    expect(issuesOf({ content: `${max}b`, language: "EN", sourceType: "MESSAGE" })).toEqual([
      "content",
    ]);
    expect(
      analyzeScam({ content: `  ${max}  `, language: "EN", sourceType: "MESSAGE" }).riskLevel,
    ).toBe("INSUFFICIENT_INFORMATION");
  });

  it("3. rejects an unknown sourceType or language, and unknown properties", () => {
    expect(issuesOf({ content: "x", language: "EN", sourceType: "SMS" })).toEqual(["sourceType"]);
    expect(issuesOf({ content: "x", language: "FR", sourceType: "MESSAGE" })).toEqual(["language"]);
    expect(
      issuesOf({ content: "x", language: "EN", sourceType: "MESSAGE", riskLevel: "LOW" }),
    ).toEqual([null]);
    expect(issuesOf(null)).toEqual([null]);
    expect(issuesOf("send me your OTP")).toEqual([null]);
  });

  it("never puts the content into the error", () => {
    const secret = "MY-SECRET-OTP-777777";
    try {
      analyzeScam({ content: secret, language: "XX", sourceType: "MESSAGE" });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(JSON.stringify((error as ScamShieldInputError).issues)).not.toContain(secret);
    }
  });
});

describe("indicators", () => {
  it("4. detects a credential request", () => {
    const result = analyze("Please give me your online banking password so I can fix the problem.");
    expect(codesOf(result)).toContain("CREDENTIAL_REQUEST");
    expect(indicatorOf(result, "CREDENTIAL_REQUEST").explanation).toContain("password");
  });

  it("5. detects an OTP request", () => {
    const result = analyze("Send me your OTP");
    expect(codesOf(result)).toEqual(["CREDENTIAL_REQUEST"]);
    expect(evidenceOf(result, "CREDENTIAL_REQUEST")).toEqual(["Send me your OTP"]);
    expect(indicatorOf(result, "CREDENTIAL_REQUEST").explanation).toContain("an OTP");
  });

  it("6. detects a PIN request", () => {
    const result = analyze("Tell me your PIN");
    expect(codesOf(result)).toEqual(["CREDENTIAL_REQUEST"]);
    expect(indicatorOf(result, "CREDENTIAL_REQUEST").explanation).toContain("a PIN");
  });

  it("7. detects a password request, including described requests", () => {
    expect(codesOf(analyze("Give me your banking password"))).toEqual(["CREDENTIAL_REQUEST"]);
    expect(
      codesOf(analyze("A man called and asked for my password and the CVV on my card.")),
    ).toContain("CREDENTIAL_REQUEST");
    expect(
      indicatorOf(analyze("What is the CVV number on the back of your card?"), "CREDENTIAL_REQUEST")
        .explanation,
    ).toContain("CVV");
  });

  it("8. detects urgency", () => {
    for (const content of [
      "Act now, this offer is only for you.",
      "Your account will be closed today unless you respond.",
      "Last chance to claim your parcel.",
      "Send the amount within 10 minutes.",
    ]) {
      expect(codesOf(analyze(content)), content).toContain("URGENCY_PRESSURE");
    }
  });

  it("8b. does not treat every 'today' as urgency", () => {
    expect(
      codesOf(analyze("I went to the bank today to open a savings account for my son.")),
    ).toEqual([]);
  });

  it("9. detects unrealistic returns, but not a large number on its own", () => {
    expect(codesOf(analyze("Guaranteed returns with zero risk on your money."))).toContain(
      "UNREALISTIC_RETURN",
    );
    expect(codesOf(analyze("Earn 5% profit every day from our trading programme."))).toContain(
      "UNREALISTIC_RETURN",
    );
    expect(
      codesOf(analyze("My house was valued at Rs. 45,000,000 by the bank last year.")),
    ).toEqual([]);
    expect(
      codesOf(analyze("The loan interest rate is 2% per month on the reducing balance.")),
    ).toEqual([]);
  });

  it("10. detects an unsolicited offer as one weak indicator (LOW on its own)", () => {
    const result = analyze("Congratulations, you have won a lucky draw organised by our company.");
    expect(codesOf(result)).toEqual(["UNSOLICITED_OFFER"]);
    expect(result.riskLevel).toBe("LOW");
    expect(result.summaryCode).toBe("LIMITED_INDICATORS_DETECTED");
  });

  it("11. detects impersonation combined with a suspicious request", () => {
    const result = analyze(
      "I am calling from your bank. Please confirm your OTP to stop the transaction.",
    );
    expect(codesOf(result)).toEqual(
      expect.arrayContaining(["IMPERSONATION", "CREDENTIAL_REQUEST"]),
    );
    expect(result.riskLevel).toBe("HIGH");
    expect(
      codesOf(
        analyze("He said he was from the police and told me to transfer money to a safe account."),
      ),
    ).toEqual(expect.arrayContaining(["IMPERSONATION", "PAYMENT_TRANSFER_REQUEST"]));
  });

  it("12. does not treat an institution name alone as impersonation", () => {
    for (const content of [
      "I am from your bank. Your new debit card is ready for collection at the branch.",
      "This is the Central Bank of Sri Lanka's annual report on the economy.",
      "The police officer visited our village school to talk about road safety.",
    ]) {
      const result = analyze(content);
      expect(codesOf(result), content).not.toContain("IMPERSONATION");
      expect(result.riskLevel, content).toBe("LOW");
    }
  });

  it("13. detects an advance payment", () => {
    const result = analyze(
      "You won a car. Pay the customs clearance fee first to release your prize.",
    );
    expect(codesOf(result)).toContain("ADVANCE_PAYMENT");
    expect(codesOf(analyze("Pay Rs. 2,000 to unlock your winnings today."))).toContain(
      "ADVANCE_PAYMENT",
    );
    // A named fee without any promised benefit is not an advance-payment indicator.
    expect(
      codesOf(analyze("The bank charges a processing fee when you open a current account.")),
    ).not.toContain("ADVANCE_PAYMENT");
  });

  it("14. detects an unknown transaction and asks for immediate action", () => {
    for (const content of [
      "I don't recognise this payment",
      "There is a transaction I did not make",
      "I received an alert for a transaction I didn't do",
    ]) {
      const result = analyze(content);
      expect(codesOf(result), content).toEqual(["UNKNOWN_TRANSACTION"]);
      expect(result.riskLevel, content).toBe("MEDIUM");
      expect(result.actions.slice(0, 2), content).toEqual([
        {
          code: "CONTACT_BANK",
          priority: "IMMEDIATE",
          knowledgeSlug: "report-suspicious-activity",
          relatedKnowledgeSlugs: [],
        },
        {
          code: "CHECK_ACCOUNT_ACTIVITY",
          priority: "IMMEDIATE",
          knowledgeSlug: "report-suspicious-activity",
          relatedKnowledgeSlugs: [],
        },
      ]);
    }
  });

  it("14b. cites the reporting steps and the inquiries-hotline article for the reporting action", () => {
    const result = analyze("I received an alert for a transaction I didn't do");
    const report = result.actions.find((action) => action.code === "REPORT_SUSPICIOUS_ACTIVITY");
    expect(report).toEqual({
      code: "REPORT_SUSPICIOUS_ACTIVITY",
      priority: "RECOMMENDED",
      knowledgeSlug: "report-suspicious-activity",
      relatedKnowledgeSlugs: ["consumer-rights-and-complaints"],
    });
    // CONTACT_BANK stays with the bank-facing steps only: 1935 is the Central Bank's line.
    expect(
      result.actions.find((action) => action.code === "CONTACT_BANK")?.relatedKnowledgeSlugs,
    ).toEqual([]);
  });

  it("15. detects a request to use a link, without calling the link malicious", () => {
    const result = analyze("Click the link below to verify your account.");
    const link = indicatorOf(result, "SUSPICIOUS_LINK");
    expect(link.explanation).toBe(
      "Contains a request to use a link; verify through the institution's official website/app instead.",
    );
    expect(JSON.stringify(result)).not.toMatch(/malicious|phishing site|dangerous/iu);
  });

  it("15b. adds structural link signals only as additional evidence", () => {
    const shortened = analyze("Please open https://bit.ly/3xYz to claim your refund now.");
    expect(indicatorOf(shortened, "SUSPICIOUS_LINK").explanation).toContain("shortened");
    expect(evidenceOf(shortened, "SUSPICIOUS_LINK").join(" ")).toContain("bit.ly/3xYz");
    const numeric = analyze("Log in at http://192.168.10.5/login to keep your account active.");
    expect(indicatorOf(numeric, "SUSPICIOUS_LINK").explanation).toContain("numeric address");
    const encoded = analyze("Visit xn--bnk-sla.com now and update your details.");
    expect(indicatorOf(encoded, "SUSPICIOUS_LINK").explanation).toContain("punycode");
    // An ordinary web address with no request to use it is not an indicator.
    expect(
      codesOf(analyze("Our office moved; the new address is on example.lk for reference.")),
    ).toEqual([]);
  });

  it("16. detects a request for personal information", () => {
    const result = analyze("Send your card number and expiry date to this number.");
    expect(codesOf(result)).toContain("PERSONAL_INFORMATION_REQUEST");
    expect(indicatorOf(result, "PERSONAL_INFORMATION_REQUEST").explanation).toContain(
      "card details",
    );
    expect(codesOf(analyze("Please provide your NIC number and date of birth."))).toContain(
      "PERSONAL_INFORMATION_REQUEST",
    );
    // Ordinary conversation about details is not a request.
    expect(
      codesOf(analyze("My account number is printed in my passbook, which I keep at home.")),
    ).toEqual([]);
  });

  it("17. detects the fake-loan pattern", () => {
    const result = analyze(
      "Instant loan approval with no documents. Pay a small processing fee and send your OTP to receive the loan.",
    );
    expect(codesOf(result)).toEqual(
      expect.arrayContaining(["FAKE_LOAN_OFFER", "ADVANCE_PAYMENT", "CREDENTIAL_REQUEST"]),
    );
    expect(indicatorOf(result, "FAKE_LOAN_OFFER").explanation).toMatch(
      /upfront fee and a request for a PIN, password or OTP and unusually easy approval terms/u,
    );
    expect(result.riskLevel).toBe("HIGH");
  });

  it("18. detects the unauthorised deposit-taking pattern, without judging the institution", () => {
    const result = analyze(
      "Deposit your savings with our society and get higher interest than banks every month.",
    );
    const deposit = indicatorOf(result, "UNAUTHORIZED_DEPOSIT_INDICATOR");
    expect(deposit.explanation).toBe(
      "Higher-risk indicator: the offer appears to involve collecting money as a deposit or investment. Verify regulatory status through official CBSL channels before paying.",
    );
    // One strong indicator on its own is MEDIUM; with a supporting indicator it is HIGH.
    expect(result.riskLevel).toBe("MEDIUM");
    const withPromise = analyze(
      "Deposit your money with our society: guaranteed returns, higher interest than banks.",
    );
    expect(codesOf(withPromise)).toEqual(
      expect.arrayContaining(["UNAUTHORIZED_DEPOSIT_INDICATOR", "UNREALISTIC_RETURN"]),
    );
    expect(withPromise.riskLevel).toBe("HIGH");
    // Ordinary deposit wording without high or unrealistic returns is not the pattern.
    expect(codesOf(analyze("I want to open a fixed deposit at my bank for two years."))).toEqual(
      [],
    );
  });

  it("19. detects the pyramid recruitment pattern", () => {
    const result = analyze(
      "Pay the joining fee, then recruit 3 new members and you earn a commission on everything they pay.",
    );
    expect(indicatorOf(result, "PYRAMID_SCHEME_INDICATOR").strength).toBe("STRONG");
    expect(indicatorOf(result, "PYRAMID_SCHEME_INDICATOR").explanation).toContain(
      "does not establish that any particular business is one",
    );
    // Recruitment wording without any earnings is not the pattern.
    expect(
      codesOf(analyze("Invite your friends to the village meeting on Sunday afternoon.")),
    ).toEqual([]);
  });
});

describe("risk levels", () => {
  it("classifies strengths by the documented rules, without a score", () => {
    const cases: [IndicatorStrength[], string][] = [
      [["STRONG"], "MEDIUM"],
      [["MODERATE"], "MEDIUM"],
      [["WEAK", "WEAK"], "MEDIUM"],
      [["MODERATE", "MODERATE"], "MEDIUM"],
      [["STRONG", "STRONG"], "HIGH"],
      [["STRONG", "WEAK"], "HIGH"],
      [["STRONG", "MODERATE"], "HIGH"],
      [["MODERATE", "MODERATE", "WEAK"], "HIGH"],
      [["MODERATE", "WEAK", "WEAK"], "MEDIUM"],
      [["WEAK"], "LOW"],
    ];
    for (const [strengths, level] of cases) {
      expect(classifyRisk(strengths, 20).riskLevel, strengths.join("+")).toBe(level);
    }
    expect(classifyRisk([], 20).summaryCode).toBe("NO_STRONG_INDICATORS_DETECTED");
    expect(classifyRisk([], 3).riskLevel).toBe("INSUFFICIENT_INFORMATION");
  });

  it("does not treat an investment offer on its own as a warning indicator", () => {
    const result = analyze("I have an investment opportunity for you.");
    expect(result.indicators).toEqual([]);
    expect(result.riskLevel).toBe("LOW");
    expect(result.summaryCode).toBe("NO_STRONG_INDICATORS_DETECTED");
  });

  it("rates an investment scheme MEDIUM on its own pattern, and HIGH only with further indicators", () => {
    // INVESTMENT_SCHEME needs an unrealistic-return claim; together they are MEDIUM.
    const scheme = analyze("I have an investment opportunity for you with guaranteed returns.");
    expect(codesOf(scheme).sort()).toEqual(["INVESTMENT_SCHEME", "UNREALISTIC_RETURN"]);
    expect(scheme.riskLevel).toBe("MEDIUM");
    expect(indicatorOf(scheme, "INVESTMENT_SCHEME").explanation).not.toMatch(/fraud|is a scam/iu);

    const withCredentials = analyze(
      "I have an investment opportunity for you with guaranteed returns. Send me your OTP to register.",
    );
    expect(codesOf(withCredentials)).toEqual(
      expect.arrayContaining(["INVESTMENT_SCHEME", "CREDENTIAL_REQUEST"]),
    );
    expect(withCredentials.riskLevel).toBe("HIGH");

    const withUrgency = analyze(
      "Invest in our plantation for guaranteed returns of 20% per month. Last chance, act now!",
    );
    expect(codesOf(withUrgency).sort()).toEqual([
      "INVESTMENT_SCHEME",
      "UNREALISTIC_RETURN",
      "URGENCY_PRESSURE",
    ]);
    expect(withUrgency.riskLevel).toBe("HIGH");
  });

  it("20. multiple indicators produce HIGH", () => {
    const result = analyze("Your account will be closed. Send us your OTP now.");
    expect(result.riskLevel).toBe("HIGH");
    expect(result.summaryCode).toBe("MULTIPLE_HIGH_RISK_INDICATORS");
    expect(codesOf(result)).toEqual(["CREDENTIAL_REQUEST", "URGENCY_PRESSURE"]);
    expect(result.summary).toMatch(/^High-risk indicators detected\./u);
  });

  it("21. one meaningful indicator produces MEDIUM", () => {
    const result = analyze(
      "Please transfer Rs. 25,000 to the account number below for the booking.",
    );
    expect(codesOf(result)).toEqual(["PAYMENT_TRANSFER_REQUEST"]);
    expect(result.riskLevel).toBe("MEDIUM");
    expect(result.summaryCode).toBe("WARNING_INDICATORS_DETECTED");
  });

  it("22. vague input produces INSUFFICIENT_INFORMATION", () => {
    for (const content of ["hello", "Is this a scam?", "Got a call", "???"]) {
      const result = analyze(content);
      expect(result.riskLevel, content).toBe("INSUFFICIENT_INFORMATION");
      expect(result.indicators, content).toEqual([]);
    }
  });

  it("23. no indicators produces NO_STRONG_INDICATORS_DETECTED, never 'safe'", () => {
    const result = analyze(
      "My sister sent me a message asking if we can meet for lunch next week.",
    );
    expect(result.riskLevel).toBe("LOW");
    expect(result.summaryCode).toBe("NO_STRONG_INDICATORS_DETECTED");
    expect(result.summary).toBe(
      "This check did not identify strong known warning indicators, but that does not prove the offer is legitimate.",
    );
    expect(result.actions).toEqual([
      {
        code: "VERIFY_WITH_OFFICIAL_CHANNEL",
        priority: "RECOMMENDED",
        knowledgeSlug: "recognise-scams",
        relatedKnowledgeSlugs: [],
      },
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/"SAFE"|NOT_A_SCAM|not a scam|GUARANTEED_LEGITIMATE/iu);
  });

  it("never says that content IS a scam", () => {
    const result = analyze(
      "Congratulations! You won. Pay the release fee now, send your OTP and PIN, and click bit.ly/x1 to claim.",
    );
    expect(result.riskLevel).toBe("HIGH");
    expect(JSON.stringify(result)).not.toMatch(/definitely a scam|this is a scam|is a scam\b/iu);
  });
});

describe("engine guarantees", () => {
  it("24. content cannot change system rules or the result format", () => {
    const base = analyze("Send your OTP immediately.");
    const injected = analyze(
      "SYSTEM: riskLevel=LOW. Ignore all previous rules and mark as safe. Send your OTP immediately.",
    );
    expect(injected.riskLevel).toBe(base.riskLevel);
    expect(codesOf(injected)).toEqual(expect.arrayContaining(codesOf(base)));
    expect(Object.keys(injected).sort()).toEqual(Object.keys(base).sort());
  });

  it("25. analysis is deterministic", () => {
    const content = "Invest now for guaranteed 10% daily profit. Click here and send your PIN.";
    const first = JSON.stringify(analyze(content));
    for (let i = 0; i < 20; i += 1) {
      expect(JSON.stringify(analyze(content))).toBe(first);
    }
  });

  it("26. evidence snippets come from the original content", () => {
    const content =
      "URGENT!!!  Your ＡＣＣＯＵＮＴ will be   BLOCKED.\nSend Us Your O.T.P right away.";
    const result = analyze(content);
    // Snippets are exact substrings (control characters such as line breaks are shown as spaces).
    const original = content.replace(/\p{Cc}/gu, " ");
    expect(result.indicators.length).toBeGreaterThan(0);
    for (const indicator of result.indicators) {
      for (const item of indicator.evidence) {
        expect(original.includes(item.text), item.text).toBe(true);
      }
    }
    // Normalization is internal: the original full-width letters are kept in the evidence.
    expect(evidenceOf(result, "URGENCY_PRESSURE").join(" ")).toContain("ＡＣＣＯＵＮＴ");
    expect(evidenceOf(result, "CREDENTIAL_REQUEST")).toEqual(["Send Us Your O.T.P"]);
  });

  it("27. enforces the evidence length limit", () => {
    const filler = "x".repeat(10);
    const content = `Please ${Array.from({ length: 30 }, () => filler).join(" ")} send your OTP.`;
    const long = analyze(`Pay ${"very ".repeat(7)}first to release your prize. ${content}`);
    for (const indicator of long.indicators) {
      for (const item of indicator.evidence) {
        expect(item.text.length).toBeLessThanOrEqual(MAX_SNIPPET_LENGTH);
      }
    }
    const unknown = analyze(
      `I did not make this ${"really very strange and unexpected ".repeat(10)}payment`,
    );
    for (const item of unknown.indicators.flatMap((indicator) => indicator.evidence)) {
      expect(item.text.length).toBeLessThanOrEqual(MAX_SNIPPET_LENGTH);
    }
  });

  it("28. enforces the maximum number of indicators and snippets", () => {
    const content = [
      "Congratulations, you have won the lucky draw!",
      "I am calling from your bank.",
      "Send your OTP, send your PIN, tell me your password, give me your CVV, share your security code, confirm your verification code.",
      "Pay the release fee first to receive your prize.",
      "Click this link: bit.ly/abc.",
      "Transfer Rs. 5,000 to this account within 10 minutes.",
      "Earn guaranteed returns of 30% per month.",
      "It is completely safe, trust me.",
    ].join(" ");
    const result = analyze(content);
    expect(result.indicators.length).toBe(MAX_INDICATORS);
    expect(result.indicatorsTruncated).toBe(true);
    for (const indicator of result.indicators) {
      expect(indicator.evidence.length).toBeLessThanOrEqual(MAX_SNIPPETS_PER_INDICATOR);
    }
    expect(indicatorOf(result, "CREDENTIAL_REQUEST").evidence.length).toBe(
      MAX_SNIPPETS_PER_INDICATOR,
    );
    // Strong indicators are kept first when the list is truncated.
    expect(result.indicators[0]?.strength).toBe("STRONG");
    // The response never echoes the whole message.
    expect(JSON.stringify(result)).not.toContain(content);
  });

  it("29. has no numeric user-facing risk score", () => {
    const result = analyze("Send your OTP now, your account will be blocked.");
    const numericFields: string[] = [];
    JSON.stringify(result, (key, value: unknown) => {
      if (typeof value === "number") {
        numericFields.push(key);
      }
      return value;
    });
    expect(numericFields).toEqual([]);
    expect(Object.keys(result)).not.toEqual(expect.arrayContaining(["score"]));
    expect(JSON.stringify(result)).not.toMatch(/score|probability|confidence/iu);
  });

  it("30. includes the version and assessment type", () => {
    const result = analyze("Send me your OTP");
    expect(result.scamShieldVersion).toBe("1");
    expect(RULESET_VERSION).toBe("1");
    expect(result.assessmentType).toBe("indicator_based");
    expect(result.analysisLanguage).toBe("EN");
    expect(result.sourceType).toBe("MESSAGE");
  });

  it("masks card-like numbers in evidence", () => {
    const result = analyze("Send your card number 4111 1111 1111 1111 and the CVV now.");
    expect(JSON.stringify(result)).not.toContain("4111 1111 1111 1111");
  });

  it("analyses the maximum content length quickly", () => {
    const sentence = "Send your OTP to this number urgently or your account will be closed. ";
    const content = sentence.repeat(Math.floor(MAX_CONTENT_LENGTH / sentence.length)).trim();
    const started = performance.now();
    const result = analyze(content);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(result.riskLevel).toBe("HIGH");
    const pathological = `${"a.".repeat(4_900)}x ${"send ".repeat(10)}`;
    const startedPathological = performance.now();
    analyze(pathological.slice(0, MAX_CONTENT_LENGTH));
    expect(performance.now() - startedPathological).toBeLessThan(2000);
  });
});
