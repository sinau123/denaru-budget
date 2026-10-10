"use client";

import Link from "next/link";
import { useMemo } from "react";

import { useCategories, useDailyTotals } from "@/hooks/use-budget-data";
import { errorMessage } from "@/lib/api/api-errors";
import { flattenCategories } from "@/lib/category-utils";
import { fillDays, summarizeDaily } from "@/lib/daily-utils";
import { formatDateShort, monthRange, todayJakarta } from "@/lib/date-utils";
import { formatRupiah } from "@/lib/money-utils";

import { DailyExpenseChart } from "./daily-chart";
import { Button } from "./ui/button";
import { cx } from "./ui/cx";
import { inputClass } from "./ui/field";
import { Notice, Skeleton } from "./ui/notice";

/** Expense per day for a month, optionally narrowed to a category (parents include their children). */
export function DailyExpenseSection({
  month,
  categoryId,
  onCategoryChange,
}: {
  month: string;
  categoryId: string | null;
  onCategoryChange: (id: string | null) => void;
}) {
  const categories = useCategories();
  const { from, to } = monthRange(month);
  const daily = useDailyTotals({ from, to, type: "expense", categoryId });
  const today = todayJakarta();
  const isCurrentMonth = today >= from && today < to;

  const days = useMemo(() => fillDays(from, to, daily.data ?? []), [from, to, daily.data]);
  const summary = useMemo(() => summarizeDaily(days, today), [days, today]);
  const options = flattenCategories(categories.data ?? [], (c) => c.type === "expense");
  const loading = daily.isPending;

  return (
    <section className="rounded-3xl border border-rule bg-paper-raised p-5" aria-labelledby="daily-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="daily-title" className="font-semibold">
          Pengeluaran harian
        </h2>
        <label className="min-w-0 max-w-full">
          <span className="sr-only">Kategori pengeluaran harian</span>
          <select
            value={categoryId ?? ""}
            onChange={(e) => onCategoryChange(e.target.value || null)}
            className={cx(inputClass, "h-9 w-auto max-w-full text-sm")}
          >
            <option value="">Semua kategori</option>
            {options.map(({ category: c, label }) => (
              <option key={c.id} value={c.id}>
                {label}
                {c.archived_at ? " (arsip)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <dl className="mb-4 grid grid-cols-3 gap-2">
        {isCurrentMonth ? (
          <DayStat label="Hari ini" value={summary.today} loading={loading} />
        ) : (
          <DayStat label="Total" value={summary.total} loading={loading} />
        )}
        <DayStat
          label="Rata-rata"
          value={summary.average}
          hint={summary.daysCounted ? `per hari, ${summary.daysCounted} hari` : undefined}
          loading={loading}
        />
        <DayStat
          label="Tertinggi"
          value={summary.peak?.expense_rupiah ?? null}
          hint={summary.peak ? formatDateShort(summary.peak.date) : undefined}
          loading={loading}
        />
      </dl>

      {daily.isError ? (
        <Notice tone="error" action={<Button size="sm" onClick={() => daily.refetch()}>Coba lagi</Button>}>
          {errorMessage(daily.error)}
        </Notice>
      ) : loading ? (
        <Skeleton className="h-52" />
      ) : (
        <DailyExpenseChart daily={days} />
      )}

      {categoryId ? (
        <Link
          href={`/transaksi?bulan=${month}&jenis=expense&kategori=${categoryId}`}
          className="mt-3 inline-block text-sm font-semibold text-accent hover:underline"
        >
          Lihat transaksinya
        </Link>
      ) : null}
    </section>
  );
}

function DayStat({ label, value, hint, loading }: { label: string; value: string | null; hint?: string; loading: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl bg-paper-sunken px-3 py-2">
      <dt className="truncate text-xs text-ink-soft">{label}</dt>
      <dd className="figure text-sm font-semibold [overflow-wrap:anywhere] sm:text-base">
        {loading ? <Skeleton className="mt-1 h-5 w-16" /> : value === null ? "—" : formatRupiah(value)}
      </dd>
      {hint && !loading ? <dd className="truncate text-[0.7rem] text-ink-faint">{hint}</dd> : null}
    </div>
  );
}
