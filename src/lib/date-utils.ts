import { DEFAULT_LOCALE, INTL_TAG, type Locale } from "./i18n/locales";

// Business dates are calendar dates ("YYYY-MM-DD") in Asia/Jakarta. They are
// never converted through a local Date, which would shift them across UTC.

export const APP_TIME_ZONE = "Asia/Jakarta";

const isoFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function todayJakarta(now: Date = new Date()): string {
  return isoFormatter.format(now);
}

export function currentMonthJakarta(now: Date = new Date()): string {
  return todayJakarta(now).slice(0, 7);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isMonth(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Inclusive start, exclusive end — matches the RPC period contract. */
export function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${shiftMonth(month, 1)}-01` };
}

type DateStyle = "long" | "short" | "month";

const DATE_STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  long: { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" },
  short: { timeZone: "UTC", day: "numeric", month: "short" },
  month: { timeZone: "UTC", month: "long", year: "numeric" },
};

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(style: DateStyle, locale: Locale): Intl.DateTimeFormat {
  const key = `${style}:${locale}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_TAG[locale], DATE_STYLES[style]);
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

export function formatDateLong(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return dateFormatter("long", locale).format(new Date(`${iso}T00:00:00Z`));
}
export function formatDateShort(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return dateFormatter("short", locale).format(new Date(`${iso}T00:00:00Z`));
}
export function formatMonth(month: string, locale: Locale = DEFAULT_LOCALE): string {
  return dateFormatter("month", locale).format(new Date(`${month}-01T00:00:00Z`));
}

/** "Hari ini" / "Kemarin" (or "Today" / "Yesterday"), otherwise the long date. */
export function relativeDayLabel(iso: string, today: string = todayJakarta(), locale: Locale = DEFAULT_LOCALE): string {
  const offset = iso === today ? 0 : iso === addDays(today, -1) ? -1 : null;
  if (offset === null) return formatDateLong(iso, locale);
  const label = new Intl.RelativeTimeFormat(INTL_TAG[locale], { numeric: "auto" }).format(offset, "day");
  return label.charAt(0).toLocaleUpperCase(INTL_TAG[locale]) + label.slice(1);
}
