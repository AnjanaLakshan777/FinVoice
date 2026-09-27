import type { Metadata } from "next";

import { voiceGatewayUrl } from "../../lib/voice/config";
import styles from "./voice.module.css";
import { VoiceConsole } from "./voice-console";

export const metadata: Metadata = {
  title: "Voice | FinVoice",
  description: "Talk with FinVoice about money in Sinhala, Tamil or English.",
};

export default function VoicePage() {
  return (
    <main className={styles.page}>
      <h1>Talk to FinVoice</h1>
      <p className={styles.intro}>
        Ask about saving, budgeting, loans or scams in Sinhala, Tamil or English. FinVoice gives
        financial education, not financial advice. Your voice is not recorded.
      </p>
      <VoiceConsole
        gatewayUrl={voiceGatewayUrl()}
        showDiagnostics={process.env.NODE_ENV !== "production"}
      />
    </main>
  );
}
