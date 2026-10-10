"use client";

import { Fragment, createContext, use, useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import type { Dictionary } from "@/lib/i18n/dictionary-id";
import { DEFAULT_LOCALE, type Locale, isLocale } from "@/lib/i18n/locales";
import { LOCALE_KEY, readLocal, writeLocal } from "@/lib/local-state";

type I18nContextValue = {
  locale: Locale;
  t: Dictionary;
  setLocale: (locale: Locale) => void;
};

// Outside the provider (e.g. component tests) the app renders in the default language.
const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  t: DICTIONARIES[DEFAULT_LOCALE],
  setLocale: () => {},
});

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  // Keeps other open tabs in sync.
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function readStoredLocale(): Locale {
  const stored = readLocal(LOCALE_KEY);
  return isLocale(stored) ? stored : DEFAULT_LOCALE;
}

/**
 * The language is a per-device preference kept in localStorage. The server
 * always renders the default language; the stored choice applies right after
 * hydration (useSyncExternalStore avoids a hydration mismatch).
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribe, readStoredLocale, () => DEFAULT_LOCALE);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    writeLocal(LOCALE_KEY, next);
    listeners.forEach((l) => l());
  }, []);

  const value = useMemo(() => ({ locale, t: DICTIONARIES[locale], setLocale }), [locale, setLocale]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18nContextValue {
  return use(I18nContext);
}

/** Fills `{name}` placeholders in a dictionary string with text or elements. */
export function rich(template: string, values: Record<string, React.ReactNode>): React.ReactNode {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{key && key in values ? values[key] : part}</Fragment>;
  });
}
