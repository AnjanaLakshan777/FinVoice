"use client";

import type { Language } from "@finvoice/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type SubmitEvent } from "react";

import {
  LANGUAGE_OPTIONS,
  OTP_ATTEMPTS_HINT,
  OTP_CODE_LENGTH,
  RESEND_COOLDOWN_SECONDS,
} from "../../../lib/account/constants";
import { friendlyError, MESSAGES } from "../../../lib/account/messages";
import { ApiError } from "../../../lib/auth/auth-client";
import { useAuth } from "../../../lib/auth/auth-context";
import styles from "../account.module.css";

type Challenge = {
  id: string;
  /** Epoch ms when the code expires (from the API's expiresIn). */
  expiresAt: number;
  /** Epoch ms when "Send a new code" is enabled again (UI convenience only). */
  resendAt: number;
  failedAttempts: number;
};

function secondsUntil(epochMs: number, now: number): number {
  return Math.max(0, Math.ceil((epochMs - now) / 1000));
}

function formatCountdown(seconds: number): string {
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Two steps: the phone number, then the code sent to it. The code is typed by the person and sent
 * once to the API; it is never shown, stored or logged by the web app.
 */
export function LoginForm() {
  const { state, client, completeSignIn } = useAuth();
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [language, setLanguage] = useState<Language>("EN");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // True while this form completes a sign-in and chooses where to go next.
  const signingIn = useRef(false);

  // Already signed in (for example after a reload): go straight to the account.
  useEffect(() => {
    if (state.status === "authenticated" && !signingIn.current) {
      router.replace("/dashboard");
    }
  }, [state.status, router]);

  // Countdown for the code's expiry and the resend pause.
  useEffect(() => {
    if (challenge === null) {
      return undefined;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [challenge]);

  async function sendCode(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const response = await client.requestOtp(phoneNumber.trim());
      const sentAt = Date.now();
      setNow(sentAt);
      setCode("");
      setChallenge({
        id: response.challengeId,
        expiresAt: sentAt + response.expiresIn * 1000,
        resendAt: sentAt + RESEND_COOLDOWN_SECONDS * 1000,
        failedAttempts: 0,
      });
    } catch (caught) {
      setError(friendlyError(caught, "requestOtp"));
    } finally {
      setBusy(false);
    }
  }

  async function onRequestCode(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await sendCode();
  }

  async function onVerify(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (challenge === null) {
      return;
    }
    if (secondsUntil(challenge.expiresAt, now) === 0) {
      setError(MESSAGES.codeExpired);
      return;
    }
    setError(null);
    setBusy(true);
    signingIn.current = true;
    try {
      await client.verifyOtp({
        challengeId: challenge.id,
        code: code.trim(),
        preferredLanguage: language,
      });
      setCode("");
      await completeSignIn();
      router.replace(await destinationAfterSignIn());
    } catch (caught) {
      signingIn.current = false;
      setCode("");
      const failedAttempts =
        caught instanceof ApiError && caught.status === 401
          ? challenge.failedAttempts + 1
          : challenge.failedAttempts;
      setChallenge({ ...challenge, failedAttempts });
      setError(
        failedAttempts >= OTP_ATTEMPTS_HINT
          ? MESSAGES.tooManyAttempts
          : friendlyError(caught, "verifyOtp"),
      );
    } finally {
      setBusy(false);
    }
  }

  /** New accounts start with onboarding; returning users go to their dashboard. */
  async function destinationAfterSignIn(): Promise<string> {
    try {
      await client.request("GET", "/me/financial-profile");
      return "/dashboard";
    } catch (caught) {
      return caught instanceof ApiError && caught.status === 404 ? "/onboarding" : "/dashboard";
    }
  }

  function changeNumber(): void {
    setChallenge(null);
    setCode("");
    setError(null);
  }

  if (state.status === "loading") {
    return <p role="status">Loading…</p>;
  }
  const notice = state.status === "unauthenticated" ? state.notice : null;

  if (challenge === null) {
    return (
      <form className={styles.form} onSubmit={(event) => void onRequestCode(event)} noValidate>
        {notice !== null && <p className={styles.notice}>{notice}</p>}
        <div className={styles.field}>
          <label htmlFor="phone">Mobile number</label>
          <p className={styles.hint} id="phone-hint">
            Include the country code: + then the number without the first 0. For Sri Lanka,
            0771234567 becomes +94771234567.
          </p>
          <input
            className={styles.input}
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+94771234567"
            aria-describedby="phone-hint"
            value={phoneNumber}
            onChange={(event) => {
              setPhoneNumber(event.target.value);
            }}
            required
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="language">Preferred language</label>
          <p className={styles.hint} id="language-hint">
            Used if this is a new account. You can change it later.
          </p>
          <select
            className={styles.select}
            id="language"
            aria-describedby="language-hint"
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
        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button className={styles.primary} type="submit" disabled={busy}>
            Send code
          </button>
        </div>
      </form>
    );
  }

  const expiresIn = secondsUntil(challenge.expiresAt, now);
  const resendIn = secondsUntil(challenge.resendAt, now);
  return (
    <form className={styles.form} onSubmit={(event) => void onVerify(event)} noValidate>
      <p className={styles.notice}>
        If this number can sign in, a code is on its way to {phoneNumber.trim()}.
      </p>
      <div className={styles.field}>
        <label htmlFor="code">{OTP_CODE_LENGTH}-digit code</label>
        <input
          className={[styles.input, styles.code].join(" ")}
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_CODE_LENGTH}
          pattern="[0-9]*"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.replace(/\D/gu, ""));
          }}
          required
        />
        <p className={styles.hint} role="timer" aria-live="off">
          {expiresIn > 0
            ? `The code expires in ${formatCountdown(expiresIn)}.`
            : "The code has expired. Send a new code."}
        </p>
      </div>
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button
          className={styles.primary}
          type="submit"
          disabled={busy || code.length !== OTP_CODE_LENGTH || expiresIn === 0}
        >
          Verify
        </button>
        <button
          className={styles.secondary}
          type="button"
          disabled={busy || resendIn > 0}
          onClick={() => void sendCode()}
        >
          {resendIn > 0 ? `Send a new code (${String(resendIn)} s)` : "Send a new code"}
        </button>
        <button className={styles.secondary} type="button" onClick={changeNumber}>
          Change number
        </button>
      </div>
    </form>
  );
}
