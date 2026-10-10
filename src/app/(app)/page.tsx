import { Suspense } from "react";

import { DashboardScreen } from "@/components/screens/dashboard-screen";
export const instant = false;

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardScreen />
    </Suspense>
  );
}
