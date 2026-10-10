"use client";

import { LOCALES, LOCALE_NAMES } from "@/lib/i18n/locales";

import { useI18n } from "./i18n-provider";
import { cx } from "./ui/cx";
import { Segmented } from "./ui/segmented";

/** Full-width choice for Settings, or a small "ID / EN" toggle for the login screen. */
export function LanguageSwitcher({ compact }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();

  if (!compact) {
    return (
      <Segmented
        label={t.settings.languageTitle}
        value={locale}
        options={LOCALES.map((value) => ({ value, label: LOCALE_NAMES[value] }))}
        onChange={setLocale}
      />
    );
  }

  return (
    <div role="radiogroup" aria-label={t.settings.languageTitle} className="flex gap-1 rounded-xl bg-paper-sunken p-1 text-xs font-semibold">
      {LOCALES.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={value === locale}
          aria-label={LOCALE_NAMES[value]}
          lang={value}
          onClick={() => setLocale(value)}
          className={cx(
            "h-7 rounded-lg px-2.5 uppercase transition",
            value === locale ? "bg-paper-raised text-ink shadow-sm" : "text-ink-soft hover:text-ink",
          )}
        >
          {value}
        </button>
      ))}
    </div>
  );
}
