import { addDays } from "./date-utils";

export type DailyExpense = { date: string; expense_rupiah: string };

/** One entry per day in [from, to), zero for days the server didn't return. */
export function fillDays(from: string, to: string, totals: readonly { occurred_on: string; expense_rupiah: string }[]): DailyExpense[] {
  const byDay = new Map(totals.map((t) => [t.occurred_on, t.expense_rupiah]));
  const days: DailyExpense[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) days.push({ date: d, expense_rupiah: byDay.get(d) ?? "0" });
  return days;
}

export type DailySummary = {
  total: string;
  /** Rounded to the nearest rupiah over the days up to today; null before the period starts. */
  average: string | null;
  daysCounted: number;
  peak: DailyExpense | null;
  /** Today's expense when today is inside the period. */
  today: string | null;
};

export function summarizeDaily(days: readonly DailyExpense[], today: string): DailySummary {
  const counted = days.filter((d) => d.date <= today);
  const total = counted.reduce((s, d) => s + BigInt(d.expense_rupiah), 0n);
  const n = BigInt(counted.length);
  let peak: DailyExpense | null = null;
  for (const d of days) {
    if (BigInt(d.expense_rupiah) > BigInt(peak?.expense_rupiah ?? "0")) peak = d;
  }
  return {
    total: total.toString(),
    average: n > 0n ? ((total * 2n + n) / (2n * n)).toString() : null,
    daysCounted: counted.length,
    peak,
    today: days.find((d) => d.date === today)?.expense_rupiah ?? null,
  };
}
