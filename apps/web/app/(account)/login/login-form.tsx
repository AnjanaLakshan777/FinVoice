"use client";

import type { Language } from "@finvoice/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type SubmitEvent } from "react";

import { LANGUAGE_OPTIONS } from "../../../lib/account/constants";
import { fieldErrors, friendlyError } from "../../../lib/account/messages";
import { useAuth } from "../../../lib/auth/auth-context";
import styles from "../account.module.css";

/**
 * Starts a guest session: only the preferred language (and an optional name). No phone number,
 * code or password. The account lives in this browser: logging out deletes it.
 */
export function LoginForm() {
  const { state, client, completeSignIn } = useAuth();
  const router = useRouter();
  const [language, setLanguage] = useState<Language>("SI");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // True while this form completes a sign-in and chooses where to go next.
  const signingIn = useRef(false);

  // Already signed in (for example after a reload): go straight to the account.
  useEffect(() => {
    if (state.status === "authenticated" && !signingIn.current) {
      router.replace("/dashboard");
    }
  }, [state.status, router]);

  async function onStart(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNameError(null);
    setBusy(true);
    signingIn.current = true;
    try {
      const displayName = name.trim();
      await client.startGuestSession({
        preferredLanguage: language,
        ...(displayName === "" ? {} : { displayName }),
      });
      await completeSignIn();
      // A new account has no details yet.
      router.replace("/onboarding");
    } catch (caught) {
      signingIn.current = false;
      setNameError(fieldErrors(caught).displayName ?? null);
      setError(friendlyError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading") {
    return <p role="status">Loading…</p>;
  }
  const notice = state.status === "unauthenticated" ? state.notice : null;

  return (
    <form className={styles.form} onSubmit={(event) => void onStart(event)} noValidate>
      {notice !== null && <p className={styles.notice}>{notice}</p>}
      <p className={styles.hint}>
        No phone number or password is needed. Your details stay with this browser until you log
        out, and logging out deletes them.
      </p>
      <div className={styles.field}>
        <label htmlFor="language">Preferred language</label>
        <select
          className={styles.select}
          id="language"
          value={language}
          onChange={(event) => {
            setLanguage(event.target.value as Language);
          }}
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.field}>
        <label htmlFor="name">Your name (optional)</label>
        <input
          className={styles.input}
          id="name"
          name="name"
          type="text"
          autoComplete="given-name"
          maxLength={100}
          value={name}
          aria-invalid={nameError !== null}
          aria-describedby={nameError !== null ? "name-error" : undefined}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        {nameError !== null && (
          <p className={styles.fieldError} id="name-error">
            {nameError}
          </p>
        )}
      </div>
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button className={styles.primary} type="submit" disabled={busy}>
          Start
        </button>
      </div>
    </form>
  );
}
