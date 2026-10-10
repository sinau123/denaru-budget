import { Suspense } from "react";

import { AuthCallbackScreen } from "@/components/screens/auth-callback-screen";

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <AuthCallbackScreen />
    </Suspense>
  );
}
