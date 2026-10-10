// Money crosses every boundary as a digit string ("125000"). BigInt is used for
// arithmetic and formatting so large values never lose precision.

export const MAX_RUPIAH = 999_999_999_999_999n;

const groupFormatter = new Intl.NumberFormat("id-ID");

/** Normalizes user input like "Rp 25.000" or "25000" to a digit string. */
export function normalizeRupiahInput(raw: string): string {
  const negative = raw.trim().startsWith("-");
  const digits = raw.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  return negative && digits !== "0" ? `-${digits}` : digits;
}

export type RupiahValidation =
  | { ok: true; value: string }
  | { ok: false; reason: "empty" | "invalid" | "not_positive" | "too_large" };

export function validateRupiah(raw: string, opts: { allowNegative?: boolean; allowZero?: boolean } = {}): RupiahValidation {
  const value = normalizeRupiahInput(raw);
  if (!value) return { ok: false, reason: "empty" };
  if (!/^-?\d{1,19}$/.test(value)) return { ok: false, reason: "invalid" };
  const n = BigInt(value);
  if (n < 0n && !opts.allowNegative) return { ok: false, reason: "not_positive" };
  if (n === 0n && !opts.allowZero) return { ok: false, reason: "not_positive" };
  if ((n < 0n ? -n : n) > MAX_RUPIAH) return { ok: false, reason: "too_large" };
  return { ok: true, value };
}

/** Formats a digit string or bigint as "Rp1.250.000" / "-Rp1.250.000". */
export function formatRupiah(value: string | bigint, opts: { signed?: boolean } = {}): string {
  const n = typeof value === "bigint" ? value : BigInt(value || "0");
  const abs = n < 0n ? -n : n;
  const body = `Rp${groupFormatter.format(abs)}`;
  if (n < 0n) return `-${body}`;
  if (opts.signed && n > 0n) return `+${body}`;
  return body;
}

/** Formats digits with thousands separators for the amount input ("25000" → "25.000"). */
export function formatRupiahInput(value: string): string {
  if (!value) return "";
  const negative = value.startsWith("-");
  const digits = value.replace(/^-/, "");
  if (!/^\d+$/.test(digits)) return value;
  return `${negative ? "-" : ""}${groupFormatter.format(BigInt(digits))}`;
}

export function sumRupiah(values: readonly string[]): string {
  return values.reduce((sum, v) => sum + BigInt(v), 0n).toString();
}

/**
 * Converts to Number for chart geometry only. Displayed values always come from
 * the original strings, so precision loss above 2^53 can never reach the user.
 */
export function rupiahToChartNumber(value: string): number {
  return Number(value);
}
