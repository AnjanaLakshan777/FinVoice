"use client";

import type { FinancialGoalResponse } from "@finvoice/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";

import { goalStatusLabel, goalTypeLabel } from "../../../../../lib/account/constants";
import { friendlyError } from "../../../../../lib/account/messages";
import { useAuth } from "../../../../../lib/auth/auth-context";
import { GoalForm } from "../../../_components/goal-form";
import { GoalProgress } from "../../../_components/goal-progress";
import styles from "../../../account.module.css";

/**
 * One goal (GET /me/goals/:goalId) and its edit form (PATCH /me/goals/:goalId). The id in the
 * address only selects the goal: the API looks it up among the signed-in person's own goals, so
 * another person's goal id is simply "not found".
 */
export function GoalDetail({ goalId }: { goalId: string }) {
  const { client } = useAuth();
  const [goal, setGoal] = useState<FinancialGoalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const path = `/me/goals/${encodeURIComponent(goalId)}`;

  useEffect(() => {
    let active = true;
    client
      .request<FinancialGoalResponse>("GET", path)
      .then((loaded) => {
        if (active) {
          setGoal(loaded);
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
  }, [client, path]);

  if (error !== null) {
    return (
      <>
        <p className={styles.error} role="alert">
          {error}
        </p>
        <p>
          <Link href="/goals">Back to goals</Link>
        </p>
      </>
    );
  }
  if (goal === null) {
    return <p role="status">Loading the goal…</p>;
  }
  return (
    <>
      <h1>{goal.name}</h1>
      <p>
        {goalTypeLabel(goal.type)} · {goalStatusLabel(goal.status)}
        {goal.targetDate === null ? "" : ` · by ${goal.targetDate}`}
      </p>
      <div className={styles.item}>
        <GoalProgress goal={goal} />
      </div>
      {saved && (
        <p className={styles.success} role="status">
          Changes saved.
        </p>
      )}
      <h2>Update this goal</h2>
      <GoalForm
        // Re-initialise the form with the API's stored values after each save.
        key={goal.updatedAt}
        mode="edit"
        initial={goal}
        submitLabel="Save changes"
        onSubmit={async (body) => {
          setSaved(false);
          setGoal(await client.request<FinancialGoalResponse>("PATCH", path, body));
          setSaved(true);
        }}
      />
      <p>
        <Link href="/goals">Back to goals</Link>
      </p>
    </>
  );
}
