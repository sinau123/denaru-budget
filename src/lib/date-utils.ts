import dayjs from "dayjs";
import "dayjs/locale/en-gb";
import "dayjs/locale/id";
import customParseFormat from "dayjs/plugin/customParseFormat";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

import { DICTIONARIES } from "./i18n/dictionaries";
import { DEFAULT_LOCALE, type Locale } from "./i18n/locales";

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

// Business dates are calendar dates ("YYYY-MM-DD") in Asia/Jakarta. They are
// parsed and shifted in UTC mode, never through a local Date, which would
// shift them across the viewer's time zone.

export const APP_TIME_ZONE = "Asia/Jakarta";

const ISO_DATE = "YYYY-MM-DD";
const ISO_MONTH = "YYYY-MM";

/** dayjs locale per app language. English keeps day-month order, like the Indonesian UI. */
const DAYJS_LOCALE: Record<Locale, string> = { id: "id", en: "en-gb" };

const calendarDate = (iso: string, locale: Locale = DEFAULT_LOCALE) =>
  dayjs.utc(iso, ISO_DATE).locale(DAYJS_LOCALE[locale]);

export function todayJakarta(now: Date = new Date()): string {
  return dayjs(now).tz(APP_TIME_ZONE).format(ISO_DATE);
}

export function currentMonthJakarta(now: Date = new Date()): string {
  return todayJakarta(now).slice(0, 7);
}

export function isIsoDate(value: string): boolean {
  return dayjs(value, ISO_DATE, true).isValid();
}

export function isMonth(value: string | null | undefined): value is string {
  return !!value && dayjs(value, ISO_MONTH, true).isValid();
}

export function addDays(iso: string, days: number): string {
  return calendarDate(iso).add(days, "day").format(ISO_DATE);
}

export function shiftMonth(month: string, delta: number): string {
  return dayjs.utc(month, ISO_MONTH).add(delta, "month").format(ISO_MONTH);
}

/** Inclusive start, exclusive end — matches the RPC period contract. */
export function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${shiftMonth(month, 1)}-01` };
}

/** "Sab, 10 Okt 2026" / "Sat, 10 Oct 2026" */
export function formatDateLong(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return calendarDate(iso, locale).format("ddd, D MMM YYYY");
}
/** "10 Okt" / "10 Oct" */
export function formatDateShort(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return calendarDate(iso, locale).format("D MMM");
}
/** "Oktober 2026" / "October 2026" */
export function formatMonth(month: string, locale: Locale = DEFAULT_LOCALE): string {
  return dayjs.utc(month, ISO_MONTH).locale(DAYJS_LOCALE[locale]).format("MMMM YYYY");
}

/** "Hari ini" / "Kemarin" (or "Today" / "Yesterday"), otherwise the long date. */
export function relativeDayLabel(iso: string, today: string = todayJakarta(), locale: Locale = DEFAULT_LOCALE): string {
  const t = DICTIONARIES[locale].common;
  if (iso === today) return t.today;
  if (iso === addDays(today, -1)) return t.yesterday;
  return formatDateLong(iso, locale);
}
