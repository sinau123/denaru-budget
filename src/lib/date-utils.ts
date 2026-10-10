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

const longDate = new Intl.DateTimeFormat("id-ID", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const shortDate = new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", day: "numeric", month: "short" });
const monthLabel = new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", month: "long", year: "numeric" });

export function formatDateLong(iso: string): string {
  return longDate.format(new Date(`${iso}T00:00:00Z`));
}
export function formatDateShort(iso: string): string {
  return shortDate.format(new Date(`${iso}T00:00:00Z`));
}
export function formatMonth(month: string): string {
  return monthLabel.format(new Date(`${month}-01T00:00:00Z`));
}

export function relativeDayLabel(iso: string, today: string = todayJakarta()): string {
  if (iso === today) return "Hari ini";
  if (iso === addDays(today, -1)) return "Kemarin";
  return formatDateLong(iso);
}
