import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginScreen } from "@/components/screens/login-screen";

export const metadata: Metadata = { title: "Masuk" };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginScreen />
    </Suspense>
  );
}
