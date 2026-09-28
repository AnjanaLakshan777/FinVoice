import type { Metadata } from "next";

import { Onboarding } from "./onboarding";

export const metadata: Metadata = { title: "My details | FinVoice" };

export default function OnboardingPage() {
  return <Onboarding />;
}
