"use client";

import type { FinancialProfileResponse, Language, UserResponse } from "@finvoice/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState, type SubmitEvent } from "react";

import { LANGUAGE_OPTIONS } from "../../../../lib/account/constants";
import { fieldErrors, friendlyError } from "../../../../lib/account/messages";
import { normalizeAmountInput } from "../../../../lib/account/money";
import { loadProfile } from "../../../../lib/account/profile";
import { useAuth } from "../../../../lib/auth/auth-context";
import { GoalForm } from "../../_components/goal-form";
import styles from "../../account.module.css";

const STEPS = ["About you", "Monthly money", "A first goal"] as const;
type Step = 0 | 1 | 2;

/**
 * First-time onboarding, and later "My details": name and language (PATCH /me), monthly income
 * and expenses (PUT /me/financial-profile), and an optional first goal (POST /me/goals). Every
 * value is validated by the API; this page calculates nothing.
 */
export function Onboarding() {
  const { client, refreshUser } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [language, setLanguage] = useState<Language>("EN");
  const [income, setIncome] = useState("");
  const [expenses, setExpenses] = useState("");
  const [currency, setCurrency] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([client.request<UserResponse>("GET", "/me"), loadProfile(client)])
      .then(([user, profile]: [UserResponse, FinancialProfileResponse | null]) => {
        if (!active) {
          return;
        }
        setDisplayName(user.displayName ?? "");
        setLanguage(user.preferredLanguage);
        setIncome(profile?.monthlyIncome ?? "");
        setExpenses(profile?.monthlyExpenses ?? "");
        setCurrency(profile?.currency);
        setLoaded(true);
      })
      .catch((caught: unknown) => {
        if (active) {
          setLoadError(friendlyError(caught));
        }
      });
    return () => {
      active = false;
    };
  }, [client]);

  async function save(action: () => Promise<void>, next: () => void): Promise<void> {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await action();
      next();
    } catch (caught) {
      setError(friendlyError(caught));
      setErrors(fieldErrors(caught));
    } finally {
      setBusy(false);
    }
  }

  function onSaveAboutYou(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    void save(
      async () => {
        await client.request("PATCH", "/me", { displayName, preferredLanguage: language });
        // The language is part of the signed-in identity (/auth/me): reload it.
        await refreshUser();
      },
      () => {
        setStep(1);
      },
    );
  }

  function onSaveMoney(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const monthlyIncome = normalizeAmountInput(income);
    const monthlyExpenses = normalizeAmountInput(expenses);
    void save(
      async () => {
        // PUT replaces the whole profile: empty means "not provided yet" (null), and the stored
        // currency is kept.
        await client.request("PUT", "/me/financial-profile", {
          monthlyIncome: monthlyIncome === "" ? null : monthlyIncome,
          monthlyExpenses: monthlyExpenses === "" ? null : monthlyExpenses,
          ...(currency === undefined ? {} : { currency }),
        });
      },
      () => {
        setStep(2);
      },
    );
  }

  if (loadError !== null) {
    return (
      <p className={styles.error} role="alert">
        {loadError}
      </p>
    );
  }
  if (!loaded) {
    return <p role="status">Loading your details…</p>;
  }

  const fieldError = (name: string) =>
    errors[name] === undefined ? null : <p className={styles.fieldError}>{errors[name]}</p>;
  const alert =
    error === null ? null : (
      <p className={styles.error} role="alert">
        {error}
      </p>
    );

  return (
    <>
      <h1>My details</h1>
      <ol className={styles.steps} aria-label="Steps">
        {STEPS.map((label, index) => (
          <li key={label} aria-current={index === step ? "step" : undefined}>
            {String(index + 1)}. {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <form className={styles.form} onSubmit={onSaveAboutYou} noValidate>
          <h2>About you</h2>
          <div className={styles.field}>
            <label htmlFor="display-name">Your name (optional)</label>
            <input
              className={styles.input}
              id="display-name"
              autoComplete="given-name"
              maxLength={100}
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
              }}
            />
            {fieldError("displayName")}
          </div>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Preferred language</legend>
            {LANGUAGE_OPTIONS.map((option) => (
              <label className={styles.choice} key={option.value}>
                <input
                  type="radio"
                  name="language"
                  value={option.value}
                  checked={language === option.value}
                  onChange={() => {
                    setLanguage(option.value);
                  }}
                />
                {option.label}
              </label>
            ))}
            {fieldError("preferredLanguage")}
          </fieldset>
          {alert}
          <div className={styles.actions}>
            <button className={styles.primary} type="submit" disabled={busy}>
              Save and continue
            </button>
          </div>
        </form>
      )}

      {step === 1 && (
        <form className={styles.form} onSubmit={onSaveMoney} noValidate>
          <h2>Your monthly money</h2>
          <p className={styles.hint}>
            Approximate amounts are fine. Leave a box empty if you prefer not to say.
          </p>
          <div className={styles.field}>
            <label htmlFor="income">Monthly income ({currency ?? "LKR"})</label>
            <input
              className={styles.input}
              id="income"
              inputMode="decimal"
              placeholder="75000"
              value={income}
              onChange={(event) => {
                setIncome(event.target.value);
              }}
            />
            {fieldError("monthlyIncome")}
          </div>
          <div className={styles.field}>
            <label htmlFor="expenses">Monthly expenses ({currency ?? "LKR"})</label>
            <input
              className={styles.input}
              id="expenses"
              inputMode="decimal"
              placeholder="50000"
              value={expenses}
              onChange={(event) => {
                setExpenses(event.target.value);
              }}
            />
            {fieldError("monthlyExpenses")}
          </div>
          {alert}
          <div className={styles.actions}>
            <button className={styles.primary} type="submit" disabled={busy}>
              Save and continue
            </button>
            <button
              className={styles.secondary}
              type="button"
              onClick={() => {
                setStep(0);
              }}
            >
              Back
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <>
          <h2>A first goal (optional)</h2>
          <GoalForm
            mode="create"
            submitLabel="Save goal and finish"
            onSubmit={async (body) => {
              await client.request("POST", "/me/goals", body);
              router.push("/dashboard");
            }}
            secondaryAction={{
              label: "Skip for now",
              onClick: () => {
                router.push("/dashboard");
              },
            }}
          />
        </>
      )}
    </>
  );
}
