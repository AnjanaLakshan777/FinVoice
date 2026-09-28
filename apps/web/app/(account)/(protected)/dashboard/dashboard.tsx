"use client";

import type {
  FinancialGoalResponse,
  FinancialProfileResponse,
  PaginatedResponse,
  UserResponse,
} from "@finvoice/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";

import { goalTypeLabel, languageLabel } from "../../../../lib/account/constants";
import { friendlyError } from "../../../../lib/account/messages";
import { formatMoney } from "../../../../lib/account/money";
import { loadProfile } from "../../../../lib/account/profile";
import { useAuth } from "../../../../lib/auth/auth-context";
import { GoalProgress } from "../../_components/goal-progress";
import styles from "../../account.module.css";

type DashboardData = {
  user: UserResponse;
  profile: FinancialProfileResponse | null;
  goals: FinancialGoalResponse[];
};

/** The signed-in person's overview: their details, monthly figures and active goals. */
export function Dashboard() {
  const { client } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      client.request<UserResponse>("GET", "/me"),
      loadProfile(client),
      client.request<PaginatedResponse<FinancialGoalResponse>>(
        "GET",
        "/me/goals?status=ACTIVE&limit=5",
      ),
    ])
      .then(([user, profile, goals]) => {
        if (active) {
          setData({ user, profile, goals: goals.data });
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(friendlyError(caught));
        }
      });
    return () => {
      active = false;
    };
  }, [client]);

  if (error !== null) {
    return (
      <p className={styles.error} role="alert">
        {error}
      </p>
    );
  }
  if (data === null) {
    return <p role="status">Loading your details…</p>;
  }
  const { user, profile, goals } = data;
  return (
    <>
      <h1>{user.displayName === null ? "Welcome" : `Welcome, ${user.displayName}`}</h1>
      <dl className={styles.summary}>
        <dt>Language</dt>
        <dd>{languageLabel(user.preferredLanguage)}</dd>
        <dt>Monthly income</dt>
        <dd>
          {profile?.monthlyIncome == null
            ? "Not added yet"
            : formatMoney(profile.monthlyIncome, profile.currency)}
        </dd>
        <dt>Monthly expenses</dt>
        <dd>
          {profile?.monthlyExpenses == null
            ? "Not added yet"
            : formatMoney(profile.monthlyExpenses, profile.currency)}
        </dd>
      </dl>
      {profile === null && (
        <p className={styles.notice}>
          <Link href="/onboarding">Add your details</Link> so FinVoice can help you plan.
        </p>
      )}

      <h2>Active goals</h2>
      {goals.length === 0 ? (
        <p>
          No goals yet. <Link href="/goals">Create a goal</Link>.
        </p>
      ) : (
        <ul className={styles.list}>
          {goals.map((goal) => (
            <li className={styles.item} key={goal.id}>
              <Link href={`/goals/${goal.id}`}>{goal.name}</Link>
              <span>{goalTypeLabel(goal.type)}</span>
              <GoalProgress goal={goal} />
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link href="/goals">All goals</Link> · <Link href="/voice">Talk to FinVoice</Link>
      </p>
    </>
  );
}
