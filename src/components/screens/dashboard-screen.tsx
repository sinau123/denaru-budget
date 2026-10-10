"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useAccounts, useDashboard, useProfile } from "@/hooks/use-budget-data";
import { errorMessage } from "@/lib/api/api-errors";
import type { Account, CategoryRollup } from "@/lib/api/api-types";
import { INTL_TAG } from "@/lib/i18n/locales";
import { currentMonthJakarta, formatMonth, isMonth } from "@/lib/date-utils";
import { formatRupiah, sumRupiah } from "@/lib/money-utils";

import { DailyExpenseSection } from "../daily-expense-section";
import { useI18n } from "../i18n-provider";
import { MonthSwitcher } from "../month-switcher";
import { useTransactionDialog } from "../transaction-dialog";
import { Button } from "../ui/button";
import { cx } from "../ui/cx";
import { EmptyState, Notice, Skeleton } from "../ui/notice";

export function DashboardScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const monthParam = params.get("bulan");
  const month = isMonth(monthParam) ? monthParam : currentMonthJakarta();
  const dailyCategoryId = params.get("kategori");
  const profile = useProfile();
  const dashboard = useDashboard(month);
  const accounts = useAccounts();
  const { openTransaction } = useTransactionDialog();
  const { t, locale } = useI18n();

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  }
  const setMonth = (m: string) => setParam("bulan", m === currentMonthJakarta() ? null : m);

  const d = dashboard.data;
  const isEmpty = d && d.income_rupiah === "0" && d.expense_rupiah === "0";
  const historyHref = `/transaksi?bulan=${month}`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-soft">{t.dashboard.greeting(profile.data?.display_name?.split(" ")[0] || null)}</p>
          <h1 className="figure text-3xl font-semibold sm:text-4xl">{t.nav.overview}</h1>
        </div>
        <MonthSwitcher month={month} onChange={setMonth} />
      </header>

      {dashboard.isError ? (
        <Notice tone="error" title={t.dashboard.loadFailed} action={<Button size="sm" onClick={() => dashboard.refetch()}>{t.common.retry}</Button>}>
          {errorMessage(dashboard.error, t)}
        </Notice>
      ) : null}

      <section aria-label={t.dashboard.cashFlow(formatMonth(month, locale))} className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label={t.transactionType.income} value={d?.income_rupiah} tone="inflow" loading={dashboard.isPending} />
        <Stat label={t.transactionType.expense} value={d?.expense_rupiah} tone="outflow" loading={dashboard.isPending} />
        <div className="col-span-2 rounded-3xl bg-ink p-5 text-paper lg:col-span-1">
          <p className="text-sm font-medium opacity-75">{t.dashboard.net}</p>
          {dashboard.isPending ? (
            <Skeleton className="mt-2 h-9 w-40 opacity-30" />
          ) : (
            <p className="figure mt-1 text-[clamp(1.6rem,8vw,1.875rem)] font-semibold [overflow-wrap:anywhere]">{formatRupiah(d?.net_rupiah ?? "0", { signed: true })}</p>
          )}
          <p className="mt-1 text-xs opacity-60">{t.dashboard.netHint}</p>
        </div>
      </section>

      {isEmpty ? (
        <EmptyState
          title={t.dashboard.emptyTitle(formatMonth(month, locale))}
          action={<Button onClick={() => openTransaction()}>{t.common.addTransaction}</Button>}
        >
          {t.dashboard.emptyBody}
        </EmptyState>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <DailyExpenseSection month={month} categoryId={dailyCategoryId} onCategoryChange={(id) => setParam("kategori", id)} />

        <section className="rounded-3xl border border-rule bg-paper-raised p-5" aria-labelledby="cat-title">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="cat-title" className="font-semibold">
              {t.dashboard.byCategory}
            </h2>
            <Link href={historyHref} className="text-sm font-semibold text-accent hover:underline">
              {t.common.history}
            </Link>
          </div>
          {d ? (
            <CategoryBreakdown items={d.expense_by_category} total={d.expense_rupiah} month={month} />
          ) : (
            <Skeleton className="h-40" />
          )}
        </section>
      </div>

      <AccountsSummary accounts={accounts.data} loading={accounts.isPending} error={accounts.error} />
    </div>
  );
}

function Stat({ label, value, tone, loading }: { label: string; value?: string; tone: "inflow" | "outflow"; loading: boolean }) {
  return (
    <div className="rounded-3xl border border-rule bg-paper-raised p-4 sm:p-5">
      <p className="flex items-center gap-2 text-sm font-medium text-ink-soft">
        <span aria-hidden className={cx("size-2 rounded-full", tone === "inflow" ? "bg-inflow" : "bg-outflow")} />
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-28" />
      ) : (
        <p className="figure mt-1 text-[clamp(1.05rem,5.2vw,1.7rem)] font-semibold [overflow-wrap:anywhere]">{formatRupiah(value ?? "0")}</p>
      )}
    </div>
  );
}

function CategoryBreakdown({ items, total, month }: { items: CategoryRollup[]; total: string; month: string }) {
  const { t, locale } = useI18n();
  if (items.length === 0) return <p className="py-8 text-center text-sm text-ink-soft">{t.dashboard.noExpenses}</p>;
  const totalN = BigInt(total) || 1n;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((c) => {
        // Percentage in tenths, computed with BigInt.
        const permille = Number((BigInt(c.total_rupiah) * 1000n) / totalN);
        return (
          <li key={c.category_id}>
            <Link href={`/transaksi?bulan=${month}&kategori=${c.category_id}`} className="group block">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium group-hover:underline">
                  {c.name}
                  {c.archived ? <span className="text-ink-faint">{t.common.archivedSuffix}</span> : null}
                </span>
                <span className="figure shrink-0 font-semibold">{formatRupiah(c.total_rupiah)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper-sunken">
                  <div className="h-full rounded-full bg-[var(--chart-bar)]" style={{ width: `${Math.max(permille / 10, 1)}%` }} />
                </div>
                <span className="w-11 text-right text-xs text-ink-faint">{(permille / 10).toLocaleString(INTL_TAG[locale])}%</span>
              </div>
            </Link>
            {c.children.length > 0 ? (
              <ul className="mt-1.5 flex flex-col gap-1 pl-3" aria-label={t.dashboard.subcategoriesOf(c.name)}>
                {c.children.map((child) => (
                  <li key={child.category_id}>
                    <Link
                      href={`/transaksi?bulan=${month}&kategori=${child.category_id}`}
                      className="flex items-baseline justify-between gap-3 text-xs text-ink-soft hover:underline"
                    >
                      <span className="truncate">
                        <span aria-hidden className="text-ink-faint">↳ </span>
                        {child.name}
                        {child.archived ? <span className="text-ink-faint">{t.common.archivedSuffix}</span> : null}
                      </span>
                      <span className="figure shrink-0">{formatRupiah(child.total_rupiah)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function AccountsSummary({ accounts, loading, error }: { accounts?: Account[]; loading: boolean; error: unknown }) {
  const { t } = useI18n();
  const total = accounts ? sumRupiah(accounts.map((a) => a.balance_rupiah)) : "0";
  return (
    <section aria-labelledby="balance-title" className="rounded-3xl border border-rule bg-paper-raised p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="balance-title" className="font-semibold">
            {t.common.currentBalance}
          </h2>
          <p className="text-xs text-ink-faint">{t.dashboard.balanceHint}</p>
        </div>
        {accounts ? <p className="figure text-2xl font-semibold">{formatRupiah(total)}</p> : null}
      </div>
      {error ? <Notice tone="error" className="mt-3">{errorMessage(error, t)}</Notice> : null}
      {loading ? <Skeleton className="mt-4 h-24" /> : null}
      {accounts ? (
        <ul className="mt-4 divide-y divide-rule">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {a.name}
                  {a.archived_at ? <span className="ml-2 rounded-full bg-paper-sunken px-2 py-0.5 text-xs text-ink-faint">{t.common.archivedBadge}</span> : null}
                </p>
                <p className="text-xs text-ink-faint">{t.accountType[a.type]}</p>
              </div>
              <p className={cx("figure shrink-0 font-semibold", a.balance_rupiah.startsWith("-") && "text-outflow")}>
                {formatRupiah(a.balance_rupiah)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
