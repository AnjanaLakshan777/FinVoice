"use client";

import type {
  FinancialGoalResponse,
  FinancialGoalStatus,
  FinancialGoalType,
} from "@finvoice/contracts";
import { useState, type SubmitEvent } from "react";

import { GOAL_STATUS_OPTIONS, GOAL_TYPE_OPTIONS } from "../../../lib/account/constants";
import { fieldErrors, friendlyError } from "../../../lib/account/messages";
import { normalizeAmountInput } from "../../../lib/account/money";
import styles from "../account.module.css";

export type GoalFormValues = {
  type: FinancialGoalType;
  name: string;
  targetAmount: string;
  currentAmount: string;
  targetDate: string;
  status: FinancialGoalStatus;
};

/** The request body for the API. Amounts are decimal strings; the API validates everything. */
export function goalRequestBody(values: GoalFormValues, mode: "create" | "edit") {
  const currentAmount = normalizeAmountInput(values.currentAmount);
  return {
    type: values.type,
    name: values.name,
    targetAmount: normalizeAmountInput(values.targetAmount),
    ...(currentAmount === "" ? {} : { currentAmount }),
    targetDate: values.targetDate === "" ? null : values.targetDate,
    ...(mode === "edit" ? { status: values.status } : {}),
  };
}

export function goalFormValues(goal?: FinancialGoalResponse): GoalFormValues {
  return {
    type: goal?.type ?? "SAVINGS",
    name: goal?.name ?? "",
    targetAmount: goal?.targetAmount ?? "",
    currentAmount: goal?.currentAmount ?? "",
    targetDate: goal?.targetDate ?? "",
    status: goal?.status ?? "ACTIVE",
  };
}

/**
 * Create or edit one goal. Goal types and statuses are the API contract's; the API checks every
 * value (amount format, current ≤ target, dates) and its messages are shown next to the fields.
 */
export function GoalForm({
  mode,
  initial,
  submitLabel,
  onSubmit,
  secondaryAction,
}: {
  mode: "create" | "edit";
  initial?: FinancialGoalResponse;
  submitLabel: string;
  onSubmit: (body: ReturnType<typeof goalRequestBody>) => Promise<void>;
  secondaryAction?: { label: string; onClick: () => void };
}) {
  const [values, setValues] = useState<GoalFormValues>(() => goalFormValues(initial));
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function set<K extends keyof GoalFormValues>(key: K, value: GoalFormValues[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await onSubmit(goalRequestBody(values, mode));
      if (mode === "create") {
        setValues(goalFormValues());
      }
    } catch (caught) {
      setError(friendlyError(caught));
      setErrors(fieldErrors(caught));
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (name: string) =>
    errors[name] === undefined ? null : (
      <p className={styles.fieldError} id={`${name}-error`}>
        {errors[name]}
      </p>
    );

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      <div className={styles.field}>
        <label htmlFor="goal-type">What is the goal?</label>
        <select
          className={styles.select}
          id="goal-type"
          value={values.type}
          onChange={(event) => {
            set("type", event.target.value as FinancialGoalType);
          }}
        >
          {GOAL_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {fieldError("type")}
      </div>
      <div className={styles.field}>
        <label htmlFor="goal-name">Name</label>
        <input
          className={styles.input}
          id="goal-name"
          value={values.name}
          maxLength={120}
          placeholder="For example: School fees"
          onChange={(event) => {
            set("name", event.target.value);
          }}
        />
        {fieldError("name")}
      </div>
      <div className={styles.field}>
        <label htmlFor="goal-target">Target amount (LKR)</label>
        <input
          className={styles.input}
          id="goal-target"
          inputMode="decimal"
          value={values.targetAmount}
          placeholder="100000"
          onChange={(event) => {
            set("targetAmount", event.target.value);
          }}
        />
        {fieldError("targetAmount")}
      </div>
      <div className={styles.field}>
        <label htmlFor="goal-current">Saved so far (LKR, optional)</label>
        <input
          className={styles.input}
          id="goal-current"
          inputMode="decimal"
          value={values.currentAmount}
          placeholder="0"
          onChange={(event) => {
            set("currentAmount", event.target.value);
          }}
        />
        {fieldError("currentAmount")}
      </div>
      <div className={styles.field}>
        <label htmlFor="goal-date">Target date (optional)</label>
        <input
          className={styles.input}
          id="goal-date"
          type="date"
          value={values.targetDate}
          onChange={(event) => {
            set("targetDate", event.target.value);
          }}
        />
        {fieldError("targetDate")}
      </div>
      {mode === "edit" && (
        <div className={styles.field}>
          <label htmlFor="goal-status">Status</label>
          <select
            className={styles.select}
            id="goal-status"
            value={values.status}
            onChange={(event) => {
              set("status", event.target.value as FinancialGoalStatus);
            }}
          >
            {GOAL_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {fieldError("status")}
        </div>
      )}
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button className={styles.primary} type="submit" disabled={busy}>
          {submitLabel}
        </button>
        {secondaryAction !== undefined && (
          <button className={styles.secondary} type="button" onClick={secondaryAction.onClick}>
            {secondaryAction.label}
          </button>
        )}
      </div>
    </form>
  );
}
