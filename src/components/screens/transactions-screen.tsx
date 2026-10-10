"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useAccounts, useCategories, useDailyTotals, useTransactions } from "@/hooks/use-budget-data";
import { errorMessage } from "@/lib/api/api-errors";
import type { TransactionFilters, TransactionType } from "@/lib/api/api-types";
import { flattenCategories } from "@/lib/category-utils";
import { addDays, currentMonthJakarta, formatMonth, isMonth, monthRange } from "@/lib/date-utils";

import { ExportButton } from "../export-button";
import { useI18n } from "../i18n-provider";
import { useTransactionDialog } from "../transaction-dialog";
import { TransactionList } from "../transaction-list";
import { Button } from "../ui/button";
import { inputClass } from "../ui/field";
import { EmptyState, Notice, Skeleton } from "../ui/notice";
import { useDebouncedValue } from "../use-debounced-value";

const TYPES: readonly TransactionType[] = ["expense", "income", "transfer"];

export function TransactionsScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const accounts = useAccounts();
  const categories = useCategories();
  const { openTransaction } = useTransactionDialog();
  const { t, locale } = useI18n();
  const s = t.transactions;

  // URL is the source of truth for filters (shareable, back/forward works).
  const period = params.get("bulan") ?? currentMonthJakarta();
  const type = TYPES.find((value) => value === params.get("jenis")) ?? null;
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
        <h1 className="figure text-3xl font-semibold sm:text-4xl">{t.nav.transactions}</h1>
        <ExportButton filters={filters} label={s.exportFiltered} />
      </header>

      <section aria-label={s.filters} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <label className="col-span-2 sm:col-span-3 lg:col-span-2">
          <span className="sr-only">{s.search}</span>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={s.searchPlaceholder}
            className={inputClass}
          />
        </label>
        <label>
          <span className="sr-only">{s.period}</span>
          <select
            value={isMonth(period) ? period : "semua"}
            onChange={(e) => setParam({ bulan: e.target.value })}
            className={inputClass}
          >
            {recentMonths(period).map((m) => (
              <option key={m} value={m}>
                {formatMonth(m, locale)}
              </option>
            ))}
            <option value="semua">{s.allTime}</option>
          </select>
        </label>
        <label>
          <span className="sr-only">{t.common.type}</span>
          <select
            value={type ?? ""}
            onChange={(e) => setParam({ jenis: e.target.value || null, kategori: null })}
            className={inputClass}
          >
            <option value="">{s.allTypes}</option>
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {t.transactionType[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{t.common.wallet}</span>
          <select value={accountId ?? ""} onChange={(e) => setParam({ dompet: e.target.value || null })} className={inputClass}>
            <option value="">{s.allWallets}</option>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.archived_at ? t.common.archivedSuffix : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{t.common.category}</span>
          <select
            value={categoryId ?? ""}
            disabled={type === "transfer"}
            onChange={(e) => setParam({ kategori: e.target.value || null })}
            className={inputClass}
          >
            <option value="">{t.common.allCategories}</option>
            {categoryOptions.map(({ category: c, label }) => (
              <option key={c.id} value={c.id}>
                {label} · {c.type === "income" ? s.categoryIn : s.categoryOut}
                {c.archived_at ? t.common.archivedSuffix : ""}
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
            {s.resetFilters}
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
        <Notice tone="error" title={s.loadFailed} action={<Button size="sm" onClick={() => query.refetch()}>{t.common.retry}</Button>}>
          {errorMessage(query.error, t)}
        </Notice>
      ) : rows.length === 0 ? (
        <EmptyState
          title={hasFilters ? s.noMatchTitle : s.emptyTitle}
          action={
            hasFilters ? null : (
              <Button onClick={() => openTransaction()}>{t.common.addTransaction}</Button>
            )
          }
        >
          {hasFilters ? s.noMatchBody : s.emptyBody}
        </EmptyState>
      ) : (
        <>
          <TransactionList rows={rows} dayTotals={dayTotals} onSelect={(transaction) => openTransaction({ transaction })} />
          {query.isFetchNextPageError ? <Notice tone="error">{errorMessage(query.error, t)}</Notice> : null}
          {query.hasNextPage ? (
            <Button variant="secondary" onClick={() => query.fetchNextPage()} pending={query.isFetchingNextPage} className="self-center">
              {s.loadMore}
            </Button>
          ) : (
            <p className="text-center text-xs text-ink-faint">{s.shown(rows.length)}</p>
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
