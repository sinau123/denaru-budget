"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useAccounts, useCategories, useDailyTotals, useTransactions } from "@/hooks/use-budget-data";
import { errorMessage } from "@/lib/api/api-errors";
import type { TransactionFilters, TransactionType } from "@/lib/api/api-types";
import { flattenCategories } from "@/lib/category-utils";
import { addDays, currentMonthJakarta, formatMonth, isMonth, monthRange } from "@/lib/date-utils";

import { ExportButton } from "../export-button";
import { useTransactionDialog } from "../transaction-dialog";
import { TransactionList } from "../transaction-list";
import { Button } from "../ui/button";
import { inputClass } from "../ui/field";
import { EmptyState, Notice, Skeleton } from "../ui/notice";
import { useDebouncedValue } from "../use-debounced-value";

const TYPES: { value: TransactionType; label: string }[] = [
  { value: "expense", label: "Pengeluaran" },
  { value: "income", label: "Pemasukan" },
  { value: "transfer", label: "Transfer" },
];

export function TransactionsScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const accounts = useAccounts();
  const categories = useCategories();
  const { openTransaction } = useTransactionDialog();

  // URL is the source of truth for filters (shareable, back/forward works).
  const period = params.get("bulan") ?? currentMonthJakarta();
  const type = (TYPES.find((t) => t.value === params.get("jenis"))?.value ?? null) as TransactionType | null;
  const accountId = params.get("dompet");
  const categoryId = type === "transfer" ? null : params.get("kategori");
  const urlSearch = params.get("q") ?? "";

  const [searchInput, setSearchInput] = useState(urlSearch);
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  function setParam(updates: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  useEffect(() => {
    if (debouncedSearch.trim() !== urlSearch) setParam({ q: debouncedSearch.trim() || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const filters: TransactionFilters = useMemo(() => {
    const range = isMonth(period) ? monthRange(period) : { from: null, to: null };
    return {
      from: range.from,
      to: range.to,
      type,
      accountId,
      categoryId,
      search: urlSearch || null,
    };
  }, [period, type, accountId, categoryId, urlSearch]);

  const query = useTransactions(filters);
  const rows = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  const hasFilters = !!(type || accountId || categoryId || urlSearch || period !== currentMonthJakarta());

  // Day headers show totals for the whole day from the server, not just the
  // rows loaded so far. Only the span of loaded days is requested.
  const newest = rows[0]?.occurred_on;
  const oldest = rows[rows.length - 1]?.occurred_on;
  const dailyFilters: TransactionFilters = useMemo(
    () => ({ ...filters, from: oldest ?? null, to: newest ? addDays(newest, 1) : null }),
    [filters, oldest, newest],
  );
  const daily = useDailyTotals(dailyFilters, !!newest);
  const dayTotals = useMemo(() => new Map((daily.data ?? []).map((d) => [d.occurred_on, d])), [daily.data]);

  // Flat, one level: picking a parent category also matches its children.
  const categoryOptions = flattenCategories(categories.data ?? [], (c) => !type || c.type === type);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="figure text-3xl font-semibold sm:text-4xl">Transaksi</h1>
        <ExportButton filters={filters} label="Ekspor hasil filter" />
      </header>

      <section aria-label="Filter" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <label className="col-span-2 sm:col-span-3 lg:col-span-2">
          <span className="sr-only">Cari catatan</span>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Cari catatan…"
            className={inputClass}
          />
        </label>
        <label>
          <span className="sr-only">Periode</span>
          <select
            value={isMonth(period) ? period : "semua"}
            onChange={(e) => setParam({ bulan: e.target.value })}
            className={inputClass}
          >
            {recentMonths(period).map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
            <option value="semua">Semua waktu</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Jenis</span>
          <select
            value={type ?? ""}
            onChange={(e) => setParam({ jenis: e.target.value || null, kategori: null })}
            className={inputClass}
          >
            <option value="">Semua jenis</option>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Dompet</span>
          <select value={accountId ?? ""} onChange={(e) => setParam({ dompet: e.target.value || null })} className={inputClass}>
            <option value="">Semua dompet</option>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.archived_at ? " (arsip)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Kategori</span>
          <select
            value={categoryId ?? ""}
            disabled={type === "transfer"}
            onChange={(e) => setParam({ kategori: e.target.value || null })}
            className={inputClass}
          >
            <option value="">Semua kategori</option>
            {categoryOptions.map(({ category: c, label }) => (
              <option key={c.id} value={c.id}>
                {label} · {c.type === "income" ? "masuk" : "keluar"}
                {c.archived_at ? " (arsip)" : ""}
              </option>
            ))}
          </select>
        </label>
      </section>
      {hasFilters ? (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchInput("");
              router.replace(pathname, { scroll: false });
            }}
          >
            Reset filter
          </Button>
        </div>
      ) : null}

      {query.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : query.isError && rows.length === 0 ? (
        <Notice tone="error" title="Gagal memuat transaksi" action={<Button size="sm" onClick={() => query.refetch()}>Coba lagi</Button>}>
          {errorMessage(query.error)}
        </Notice>
      ) : rows.length === 0 ? (
        <EmptyState
          title={hasFilters ? "Tidak ada transaksi yang cocok" : "Belum ada transaksi"}
          action={
            hasFilters ? null : (
              <Button onClick={() => openTransaction()}>Tambah transaksi</Button>
            )
          }
        >
          {hasFilters ? "Ubah atau reset filter untuk melihat transaksi lain." : "Transaksi yang dicatat akan muncul di sini."}
        </EmptyState>
      ) : (
        <>
          <TransactionList rows={rows} dayTotals={dayTotals} onSelect={(transaction) => openTransaction({ transaction })} />
          {query.isFetchNextPageError ? <Notice tone="error">{errorMessage(query.error)}</Notice> : null}
          {query.hasNextPage ? (
            <Button variant="secondary" onClick={() => query.fetchNextPage()} pending={query.isFetchingNextPage} className="self-center">
              Muat lebih banyak
            </Button>
          ) : (
            <p className="text-center text-xs text-ink-faint">{rows.length} transaksi ditampilkan.</p>
          )}
        </>
      )}
    </div>
  );
}

function recentMonths(selected: string): string[] {
  const current = currentMonthJakarta();
  const months: string[] = [];
  let m = current;
  for (let i = 0; i < 24; i++) {
    months.push(m);
    const [y, mo] = m.split("-").map(Number);
    m = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
  }
  if (isMonth(selected) && !months.includes(selected)) months.push(selected);
  return months;
}
