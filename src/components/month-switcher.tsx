"use client";

import { currentMonthJakarta, formatMonth, shiftMonth } from "@/lib/date-utils";

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const current = currentMonthJakarta();
  const atCurrent = month >= current;
  return (
    <div className="flex items-center gap-1 rounded-2xl border border-rule bg-paper-raised p-1">
      <button
        type="button"
        aria-label="Bulan sebelumnya"
        onClick={() => onChange(shiftMonth(month, -1))}
        className="grid size-9 place-items-center rounded-xl text-ink-soft hover:bg-paper-sunken hover:text-ink"
      >
        ‹
      </button>
      <label className="relative">
        <span className="sr-only">Pilih bulan</span>
        <input
          type="month"
          value={month}
          max={current}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
        <span aria-hidden className="block min-w-32 px-2 text-center text-sm font-semibold">
          {formatMonth(month)}
        </span>
      </label>
      <button
        type="button"
        aria-label="Bulan berikutnya"
        disabled={atCurrent}
        onClick={() => onChange(shiftMonth(month, 1))}
        className="grid size-9 place-items-center rounded-xl text-ink-soft hover:bg-paper-sunken hover:text-ink disabled:opacity-30"
      >
        ›
      </button>
    </div>
  );
}
