import { describe, expect, it } from "vitest";

import type { IndicatorCode } from "../src/index.js";
import { analyze, codesOf } from "./helpers.js";

// Legitimate warnings (including FinVoice's own knowledge-base text) and ordinary messages must not
// be reported as requests for credentials, details, money or links.

const REQUEST_INDICATORS: readonly IndicatorCode[] = [
  "CREDENTIAL_REQUEST",
  "PERSONAL_INFORMATION_REQUEST",
  "PAYMENT_TRANSFER_REQUEST",
  "ACCOUNT_ACCESS_REQUEST",
  "SUSPICIOUS_LINK",
  "ADVANCE_PAYMENT",
];

describe("legitimate warnings are not requests", () => {
  it.each([
    [
      "EN",
      "Never share these with anyone: your account username and password, your PIN, an OTP sent to your phone, your card number, expiry date or the security code on the back of the card (CVV).",
    ],
    [
      "EN",
      "Never share your PIN, password or OTP. No bank or trusted authority will ever ask for them.",
    ],
    [
      "EN",
      "Be careful about sharing your account numbers, card details (including the expiry date and CVV number) and your NIC number.",
    ],
    [
      "EN",
      "If someone asks you for your PIN or OTP, tell your bank or financial institution immediately.",
    ],
    ["EN", "Your OTP for the transaction is 482913. Do not share it with anyone."],
    [
      "EN",
      "Do not click links in messages from unknown numbers, and do not make payments to unseen people.",
    ],
    ["EN", "We will never ask you to send your password or to transfer money to a safe account."],
    [
      "SI",
      "ඔබේ PIN අංකය, එක් වරක් භාවිත මුරපදය (OTP), මුරපද හෝ කාඩ්පත් විස්තර කිසිවෙකුටත් ලබා නොදෙන්න.",
    ],
    ["SI", "යමෙක් ඔබෙන් මෙම තොරතුරු ඉල්ලා සිටියහොත්, වහාම ඔබේ බැංකුවට හෝ මූල්‍ය ආයතනයට දන්වන්න."],
    [
      "TA",
      "உங்கள் PIN, ஒருமுறை கடவுச்சொல் (OTP), கடவுச்சொற்கள் அல்லது அட்டை விவரங்களை யாருடனும் பகிர வேண்டாம்.",
    ],
    [
      "TA",
      "யாராவது இந்தத் தகவல்களைக் கேட்டால், உடனடியாக உங்கள் வங்கிக்கு அல்லது நிதி நிறுவனத்திற்குத் தெரிவியுங்கள்.",
    ],
  ] as const)("%s: %s", (language, content) => {
    const codes = codesOf(analyze(content, language));
    for (const code of REQUEST_INDICATORS) {
      expect(codes, content).not.toContain(code);
    }
  });
});

describe("ordinary messages", () => {
  it.each([
    "Hi Amma, I reached Colombo safely. I will call you after work tomorrow.",
    "The bank branch will be closed on Poya day. Please visit on Monday.",
    "Your electricity bill for September is ready. Thank you for being our customer.",
    "I opened a savings account at the bank for my daughter's education.",
    "Our cricket team won the match on Sunday by five wickets.",
  ])("%s", (content) => {
    const result = analyze(content);
    expect(result.riskLevel).toBe("LOW");
    expect(result.summaryCode).toBe("NO_STRONG_INDICATORS_DETECTED");
  });
});
