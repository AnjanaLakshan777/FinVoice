"use client";

import type { FinancialGoalResponse, PaginatedResponse } from "@finvoice/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";

import { goalStatusLabel, goalTypeLabel } from "../../../../lib/account/constants";
import { friendlyError } from "../../../../lib/account/messages";
import { useAuth } from "../../../../lib/auth/auth-context";
import { GoalForm } from "../../_components/goal-form";
import { GoalProgress } from "../../_components/goal-progress";
import styles from "../../account.module.css";

/** At most this many goals are listed (the API's maximum page size is 100). */
const PAGE_SIZE = 50;

/** The signed-in person's goals (GET /me/goals) and a form to add one (POST /me/goals). */
export function Goals() {
  const { client } = useAuth();
  const [goals, setGoals] = useState<FinancialGoalResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  /** Incremented after a goal is added, to reload the list from the API. */
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    client
      .request<PaginatedResponse<FinancialGoalResponse>>(
        "GET",
        `/me/goals?limit=${String(PAGE_SIZE)}`,
      )
      .then((page) => {
        if (active) {
          setGoals(page.data);
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
  }, [client, version]);

  return (
    <>
      <h1>Goals</h1>
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {goals === null && error === null && <p role="status">Loading your goals…</p>}
      {goals !== null &&
        (goals.length === 0 ? (
          <p>You have no goals yet. Add your first one below.</p>
        ) : (
          <ul className={styles.list} aria-label="Your goals">
            {goals.map((goal) => (
              <li className={styles.item} key={goal.id}>
                <Link href={`/goals/${goal.id}`}>{goal.name}</Link>
                <span>
                  {goalTypeLabel(goal.type)} · {goalStatusLabel(goal.status)}
                  {goal.targetDate === null ? "" : ` · by ${goal.targetDate}`}
                </span>
                <GoalProgress goal={goal} />
              </li>
            ))}
          </ul>
        ))}

      <h2>Add a goal</h2>
      {created !== null && (
        <p className={styles.success} role="status">
          Goal “{created}” added.
        </p>
      )}
      <GoalForm
        mode="create"
        submitLabel="Add goal"
        onSubmit={async (body) => {
          const goal = await client.request<FinancialGoalResponse>("POST", "/me/goals", body);
          setCreated(goal.name);
          setVersion((current) => current + 1);
        }}
      />
    </>
  );
}
