"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "../auth-provider";

/** supabase-js exchanges the PKCE code automatically (detectSessionInUrl). */
export function AuthCallbackScreen() {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const providerError = params.get("error");

  useEffect(() => {
    if (providerError) {
      router.replace("/login?alasan=batal");
      return;
    }
    if (auth.status === "signed-in") router.replace("/");
    if (auth.status === "signed-out") {
      // Give the code exchange a moment before declaring failure.
      const id = window.setTimeout(() => router.replace("/login?alasan=batal"), 4000);
      return () => window.clearTimeout(id);
    }
  }, [auth.status, providerError, router]);

  return (
    <main className="grid min-h-dvh place-items-center">
      <p className="figure animate-pulse text-2xl text-ink-soft">Menyelesaikan login…</p>
    </main>
  );
}
