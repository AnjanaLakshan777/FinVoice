import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./home.module.css";

type Feature = { title: string; text: string; icon: ReactNode };

const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const FEATURES: Feature[] = [
  {
    title: "Exact calculations",
    text: "Loan repayments, savings plans and budgets come from FinVoice's calculator, never from guesses.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2" />
      </svg>
    ),
  },
  {
    title: "Sourced information",
    text: "Answers about saving, borrowing and your rights come from FinVoice's library of sourced articles, and FinVoice names the source.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2V5Z" />
        <path d="M8 7h6M8 11h6" />
      </svg>
    ),
  },
  {
    title: "Safer from scams",
    text: "Learn how common scams work. FinVoice never asks for your PIN, OTP or password.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
];

export default function HomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="home-title">
        <p className={styles.greeting} lang="mul">
          ආයුබෝවන් · வணக்கம் · Welcome
        </p>
        <h1 id="home-title">Talk about money in your own language</h1>
        <p className={styles.lead}>
          FinVoice explains saving, budgeting, loans and scams in simple Sinhala, Tamil or English.
          Ask by voice and get clear answers.
        </p>
        <p className={styles.sinhala} lang="si">
          මුදල් ගැන ඔයාගේ භාෂාවෙන්ම කතා කරන්න.
        </p>
        <div className={styles.actions}>
          <Link href="/voice" className={styles.primary}>
            <svg {...ICON_PROPS} width={18} height={18} aria-hidden="true">
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm7 9a7 7 0 0 1-14 0m7 7v2" />
            </svg>
            Start talking
          </Link>
          <Link href="/login" className={styles.secondary}>
            Sign in
          </Link>
        </div>
      </section>

      <section aria-labelledby="features-title">
        <h2 id="features-title" className={styles.sectionTitle}>
          What FinVoice does
        </h2>
        <ul className={styles.features}>
          {FEATURES.map((feature) => (
            <li key={feature.title} className={styles.feature}>
              <span className={styles.icon}>{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="steps-title">
        <h2 id="steps-title" className={styles.sectionTitle}>
          How it works
        </h2>
        <ol className={styles.steps}>
          <li>
            <div>
              <strong>Choose your language</strong>
              <span>Sinhala, Tamil or English.</span>
            </div>
          </li>
          <li>
            <div>
              <strong>Press Start and ask</strong>
              <span>Speak naturally, as you would to a friend.</span>
            </div>
          </li>
          <li>
            <div>
              <strong>Listen to the answer</strong>
              <span>You can interrupt at any time to ask something new.</span>
            </div>
          </li>
        </ol>
      </section>
    </main>
  );
}
