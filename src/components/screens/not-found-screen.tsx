"use client";

import Link from "next/link";

import { useI18n } from "../i18n-provider";

export function NotFoundScreen() {
  const { t } = useI18n();
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <h1 className="figure text-3xl font-semibold">{t.notFound.title}</h1>
        <Link href="/" className="mt-4 inline-block font-semibold text-accent hover:underline">
          {t.notFound.back}
        </Link>
      </div>
    </main>
  );
}
