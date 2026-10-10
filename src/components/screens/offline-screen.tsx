"use client";

import { useI18n } from "../i18n-provider";

export function OfflineScreen() {
  const { t } = useI18n();
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="max-w-sm">
        <p className="figure text-4xl font-semibold">
          denaru<span className="text-accent">.</span>
        </p>
        <h1 className="mt-6 text-xl font-semibold">{t.offline.title}</h1>
        <p className="mt-2 text-ink-soft">{t.offline.body}</p>
        {/* A full page load is intended here so the network is retried. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="mt-6 inline-flex h-11 items-center rounded-xl bg-accent px-5 font-semibold text-accent-ink">
          {t.common.retry}
        </a>
      </div>
    </main>
  );
}
