"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { DailyExpense } from "@/lib/daily-utils";
import { formatDateLong, formatDateShort } from "@/lib/date-utils";
import { INTL_TAG } from "@/lib/i18n/locales";
import { formatRupiah, rupiahToChartNumber } from "@/lib/money-utils";

import { useI18n } from "./i18n-provider";

type Point = { date: string; label: string; value: number; raw: string };

/** Single-series daily expense bars, with an equivalent data table for screen readers. */
export function DailyExpenseChart({ daily }: { daily: readonly DailyExpense[] }) {
  const { t, locale } = useI18n();
  const compact = new Intl.NumberFormat(INTL_TAG[locale], { notation: "compact", maximumFractionDigits: 1 });
  const data: Point[] = daily.map((d) => ({
    date: d.date,
    label: String(Number(d.date.slice(8))),
    value: rupiahToChartNumber(d.expense_rupiah),
    raw: d.expense_rupiah,
  }));
  const hasData = data.some((d) => d.value > 0);

  return (
    <figure>
      <div className="h-52 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="2 4" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "var(--rule)" }}
              tick={{ fill: "var(--ink-faint)", fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--ink-faint)", fontSize: 11 }}
              tickFormatter={(v: number) => compact.format(v)}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: "var(--paper-sunken)" }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as Point | undefined;
                if (!active || !p) return null;
                return (
                  <div className="rounded-xl border border-rule bg-paper-raised px-3 py-2 text-sm shadow-lg">
                    <p className="text-ink-soft">{formatDateLong(p.date, locale)}</p>
                    <p className="figure text-base font-semibold text-ink">{formatRupiah(p.raw)}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="value" fill="var(--chart-bar)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 flex items-center justify-between gap-3 text-xs text-ink-faint">
        <span>{hasData ? t.dailyChart.caption : t.dailyChart.empty}</span>
        <details className="group relative">
          <summary className="cursor-pointer select-none font-semibold text-ink-soft hover:text-ink">{t.dailyChart.showTable}</summary>
          <div className="absolute right-0 z-10 mt-2 max-h-72 w-60 overflow-y-auto rounded-xl border border-rule bg-paper-raised p-2 shadow-lg">
            <table className="w-full text-sm">
              <caption className="sr-only">{t.dailyChart.tableCaption}</caption>
              <thead>
                <tr className="text-left text-ink-faint">
                  <th className="px-2 py-1 font-medium">{t.common.date}</th>
                  <th className="px-2 py-1 text-right font-medium">{t.transactionType.expense}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.date} className="border-t border-rule">
                    <td className="px-2 py-1 text-ink-soft">{formatDateShort(d.date, locale)}</td>
                    <td className="px-2 py-1 text-right text-ink">{formatRupiah(d.raw)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </figcaption>
    </figure>
  );
}
