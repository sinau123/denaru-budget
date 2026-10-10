import type { Metadata } from "next";

import { OnboardingScreen } from "@/components/screens/onboarding-screen";
import { RequireSession } from "@/components/session-gate";

export const metadata: Metadata = { title: "Mulai" };

export default function OnboardingPage() {
  return (
    <RequireSession>
      <OnboardingScreen />
    </RequireSession>
  );
}
