import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";
import styles from "./layout.module.css";

export const metadata: Metadata = {
  title: "FinVoice",
  description: "Voice-first financial inclusion and financial literacy for Sri Lanka.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <Link href="/" className={styles.brand}>
              <span className={styles.logo} aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm7 9a7 7 0 0 1-14 0m7 7v2"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              FinVoice
            </Link>
            <nav className={styles.nav} aria-label="Main">
              <Link href="/voice">Talk to FinVoice</Link>
              <Link href="/dashboard">My account</Link>
            </nav>
          </div>
        </header>
        <div className={styles.content}>{children}</div>
        <footer className={styles.footer}>
          <div className={styles.footerInner}>
            <p>
              FinVoice gives financial education, not financial advice. It never asks for your PIN,
              OTP or password, and your voice is not recorded.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
