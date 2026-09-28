import type { Metadata } from "next";

import { Goals } from "./goals";

export const metadata: Metadata = { title: "Goals | FinVoice" };

export default function GoalsPage() {
  return <Goals />;
}
