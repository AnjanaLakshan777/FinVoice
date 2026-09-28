import type { FinancialGoalResponse } from "@finvoice/contracts";

import { formatMoney, toCents } from "../../../lib/account/money";
import styles from "../account.module.css";

/**
 * Progress exactly as the API reports it: the saved and target amounts, and a native <progress>
 * bar over whole cents (exact integers, no floating-point money arithmetic, no calculated result).
 */
export function GoalProgress({ goal }: { goal: FinancialGoalResponse }) {
  const current = toCents(goal.currentAmount);
  const target = toCents(goal.targetAmount);
  const label = `${formatMoney(goal.currentAmount, goal.currency)} of ${formatMoney(goal.targetAmount, goal.currency)} saved`;
  return (
    <>
      <span>{label}</span>
      {current !== null && target !== null && target > 0 && (
        <progress className={styles.progress} value={current} max={target} aria-label={label} />
      )}
    </>
  );
}
