import type { Metadata } from "next";

import { GoalDetail } from "./goal-detail";

export const metadata: Metadata = { title: "Goal | FinVoice" };

export default async function GoalPage({ params }: { params: Promise<{ goalId: string }> }) {
  const { goalId } = await params;
  return <GoalDetail goalId={goalId} />;
}
