export const LOCALES = ["id", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "id";

/** Each language is named in itself so it can be found from either UI. */
export const LOCALE_NAMES: Record<Locale, string> = {
  id: "Bahasa Indonesia",
  en: "English",
};

/** BCP 47 tag for Intl formatters. English keeps day-month order, like the Indonesian UI. */
export const INTL_TAG: Record<Locale, string> = {
  id: "id-ID",
  en: "en-GB",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
