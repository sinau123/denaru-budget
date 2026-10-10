"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useProfile } from "@/hooks/use-budget-data";
import { errorMessage } from "@/lib/api/api-errors";
import { readLocal, writeLocal } from "@/lib/local-state";

import { AccountForm } from "../account-form";
import { useAuth, useUserId } from "../auth-provider";
import { useI18n } from "../i18n-provider";
import { Button } from "../ui/button";
import { Notice } from "../ui/notice";

export function OnboardingScreen() {
  const userId = useUserId();
  const auth = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  // loadProfile() bootstraps the profile and default categories idempotently.
  const profile = useProfile();
  const storageKey = `onboarding-wallet:${userId}`;
  // Persist the first wallet's ID so a retry after an interruption can't duplicate it.
  // Only rendered client-side after the session is known (RequireSession).
  const [walletId] = useState(() => {
    const existing = readLocal(storageKey);
    const id = existing ?? crypto.randomUUID();
    if (!existing) writeLocal(storageKey, id);
    return id;
  });

  useEffect(() => {
    if (profile.data?.has_accounts) {
      writeLocal(storageKey, null);
      router.replace("/");
    }
  }, [profile.data?.has_accounts, router, storageKey]);

  return (
    <main className="ledger-bg grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-lg">
        <p className="figure text-2xl font-semibold">
          denaru<span className="text-accent">.</span>
        </p>
        <h1 className="figure mt-6 text-4xl font-semibold leading-tight">{t.onboarding.title}</h1>
        <p className="mt-3 text-ink-soft">
          {t.onboarding.intro}
        </p>
        <div className="mt-8 rounded-3xl border border-rule bg-paper-raised p-5 shadow-sm sm:p-6">
          {profile.isError ? (
            <Notice tone="error" action={<Button size="sm" onClick={() => profile.refetch()}>{t.common.retry}</Button>}>
              {errorMessage(profile.error, t)}
            </Notice>
          ) : walletId && profile.data ? (
            <AccountForm
              clientId={walletId}
              submitLabel={t.onboarding.submit}
              onDone={() => {
                writeLocal(storageKey, null);
                router.replace("/");
              }}
            />
          ) : (
            <p className="py-8 text-center text-ink-soft">{t.onboarding.preparing}</p>
          )}
        </div>
        <button type="button" onClick={() => auth.signOut()} className="mt-6 text-sm font-semibold text-ink-soft hover:text-ink">
          {t.onboarding.notYou}
        </button>
      </div>
    </main>
  );
}
