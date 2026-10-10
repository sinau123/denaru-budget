"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useProfile } from "@/hooks/use-budget-data";
import { errorMessage } from "@/lib/api/api-errors";

import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
import { Notice } from "./ui/notice";

function Splash({ label = "Memuat…" }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center">
      <p className="figure animate-pulse text-2xl text-ink-soft">{label}</p>
    </div>
  );
}

/** Redirects to login when signed out; renders children once a session exists. */
export function RequireSession({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "signed-out") {
      router.replace(auth.reason === "expired" ? "/login?alasan=sesi" : "/login");
    }
  }, [auth, router]);

  if (auth.status !== "signed-in") return <Splash />;
  // Keyed by user so no component state survives an account switch.
  return <div key={auth.userId}>{children}</div>;
}

/** Ensures the profile exists and onboarding is complete before the app shell. */
export function RequireOnboarded({ children }: { children: React.ReactNode }) {
  const profile = useProfile();
  const router = useRouter();
  const pathname = usePathname();
  const needsOnboarding = profile.data && !profile.data.has_accounts;

  useEffect(() => {
    if (needsOnboarding && pathname !== "/onboarding") router.replace("/onboarding");
  }, [needsOnboarding, pathname, router]);

  if (profile.isPending) return <Splash />;
  if (profile.isError) {
    return (
      <div className="mx-auto grid min-h-dvh max-w-md place-items-center px-4">
        <Notice
          tone="error"
          title="Tidak dapat terhubung"
          action={<Button onClick={() => profile.refetch()}>Coba lagi</Button>}
        >
          {errorMessage(profile.error)} Jika aplikasi lama tidak dipakai, layanan database mungkin sedang dijeda oleh
          penyedia; data tidak dianggap tersimpan sampai koneksi pulih.
        </Notice>
      </div>
    );
  }
  if (needsOnboarding) return <Splash />;
  return children;
}
