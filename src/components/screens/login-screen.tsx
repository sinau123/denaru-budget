"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "../auth-provider";
import { useI18n } from "../i18n-provider";
import { LanguageSwitcher } from "../language-switcher";
import { Button } from "../ui/button";
import { Notice } from "../ui/notice";

export function LoginScreen() {
  const auth = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status === "signed-in") router.replace("/");
  }, [auth.status, router]);

  const expired = params.get("alasan") === "sesi" || (auth.status === "signed-out" && auth.reason === "expired");
  const cancelled = params.get("alasan") === "batal";

  return (
    <main className="ledger-bg grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-end">
          <LanguageSwitcher compact />
        </div>
        <p className="figure text-5xl font-semibold tracking-tight">
          denaru<span className="text-accent">.</span>
        </p>
        <p className="mt-4 text-lg text-ink-soft">{t.login.tagline}</p>

        <div className="mt-10 flex flex-col gap-3">
          {expired ? <Notice tone="warn">{t.errors.sessionExpired}</Notice> : null}
          {cancelled ? <Notice tone="info">{t.login.cancelled}</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button
            size="lg"
            pending={pending || auth.status === "loading"}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await auth.signInWithGoogle();
              } catch {
                setPending(false);
                setError(t.login.googleFailed);
              }
            }}
          >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
              <path fill="currentColor" d="M21.35 11.1H12v2.98h5.35c-.23 1.43-1.66 4.2-5.35 4.2-3.22 0-5.85-2.67-5.85-5.96S8.78 6.36 12 6.36c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.68 3.8 14.53 2.85 12 2.85 6.98 2.85 2.92 6.92 2.92 12s4.06 9.15 9.08 9.15c5.24 0 8.72-3.68 8.72-8.87 0-.6-.07-1.05-.15-1.5z" />
            </svg>
            {t.login.google}
          </Button>
          <p className="text-xs text-ink-faint">{t.login.privacy}</p>
        </div>
      </div>
    </main>
  );
}
