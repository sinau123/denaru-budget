"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useAccounts, useDashboard, useProfile } from "@/hooks/use-budget-data";
import { errorMessage } from "@/lib/api/api-errors";
import type { Account, CategoryTotal } from "@/lib/api/api-types";
import { currentMonthJakarta, formatMonth, isMonth } from "@/lib/date-utils";
import { formatRupiah, sumRupiah } from "@/lib/money-utils";

import { DailyExpenseChart } from "../daily-chart";
import { MonthSwitcher } from "../month-switcher";
import { useTransactionDialog } from "../transaction-dialog";
import { Button } from "../ui/button";
import { cx } from "../ui/cx";
import { EmptyState, Notice, Skeleton } from "../ui/notice";

export const ACCOUNT_TYPE_LABEL: Record<Account["type"], string> = {
  cash: "Tunai",
  bank: "Bank",
  ewallet: "E-wallet",
};

export function DashboardScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const monthParam = params.get("bulan");
  const month = isMonth(monthParam) ? monthParam : currentMonthJakarta();
  const profile = useProfile();
  const dashboard = useDashboard(month);
  const accounts = useAccounts();
  const { openTransaction } = useTransactionDialog();

  const setMonth = (m: string) => {
    const next = new URLSearchParams(params);
    if (m === currentMonthJakarta()) next.delete("bulan");
    else next.set("bulan", m);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const d = dashboard.data;
  const isEmpty = d && d.income_rupiah === "0" && d.expense_rupiah === "0";
  const historyHref = `/transaksi?bulan=${month}`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-soft">Halo{profile.data?.display_name ? `, ${profile.data.display_name.split(" ")[0]}` : ""}</p>
          <h1 className="figure text-3xl font-semibold sm:text-4xl">Ringkasan</h1>
        </div>
        <MonthSwitcher month={month} onChange={setMonth} />
      </header>

      {dashboard.isError ? (
        <Notice tone="error" title="Gagal memuat ringkasan" action={<Button size="sm" onClick={() => dashboard.refetch()}>Coba lagi</Button>}>
          {errorMessage(dashboard.error)}
        </Notice>
      ) : null}

      <section aria-label={`Arus kas ${formatMonth(month)}`} className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Pemasukan" value={d?.income_rupiah} tone="inflow" loading={dashboard.isPending} />
        <Stat label="Pengeluaran" value={d?.expense_rupiah} tone="outflow" loading={dashboard.isPending} />
        <div className="col-span-2 rounded-3xl bg-ink p-5 text-paper lg:col-span-1">
          <p className="text-sm font-medium opacity-75">Selisih arus kas</p>
          {dashboard.isPending ? (
            <Skeleton className="mt-2 h-9 w-40 opacity-30" />
          ) : (
            <p className="figure mt-1 text-[clamp(1.6rem,8vw,1.875rem)] font-semibold [overflow-wrap:anywhere]">{formatRupiah(d?.net_rupiah ?? "0", { signed: true })}</p>
          )}
          <p className="mt-1 text-xs opacity-60">Pemasukan − pengeluaran. Saldo awal dan transfer tidak dihitung.</p>
        </div>
      </section>

      {isEmpty ? (
        <EmptyState
          title={`Belum ada transaksi di ${formatMonth(month)}`}
          action={<Button onClick={() => openTransaction()}>Tambah transaksi</Button>}
        >
          Semua angka bernilai nol. Catat pengeluaran atau pemasukan pertama untuk melihat ringkasan.
        </EmptyState>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-3xl border border-rule bg-paper-raised p-5" aria-labelledby="daily-title">
          <h2 id="daily-title" className="mb-3 font-semibold">
            Pengeluaran harian
          </h2>
          {d ? <DailyExpenseChart daily={d.daily} /> : <Skeleton className="h-52" />}
        </section>

        <section className="rounded-3xl border border-rule bg-paper-raised p-5" aria-labelledby="cat-title">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="cat-title" className="font-semibold">
              Per kategori
            </h2>
            <Link href={historyHref} className="text-sm font-semibold text-accent hover:underline">
              Riwayat
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

function CategoryBreakdown({ items, total, month }: { items: CategoryTotal[]; total: string; month: string }) {
  if (items.length === 0) return <p className="py-8 text-center text-sm text-ink-soft">Belum ada pengeluaran.</p>;
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
                  {c.archived ? <span className="text-ink-faint"> (arsip)</span> : null}
                </span>
                <span className="figure shrink-0 font-semibold">{formatRupiah(c.total_rupiah)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper-sunken">
                  <div className="h-full rounded-full bg-[var(--chart-bar)]" style={{ width: `${Math.max(permille / 10, 1)}%` }} />
                </div>
                <span className="w-11 text-right text-xs text-ink-faint">{(permille / 10).toLocaleString("id-ID")}%</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function AccountsSummary({ accounts, loading, error }: { accounts?: Account[]; loading: boolean; error: unknown }) {
  const total = accounts ? sumRupiah(accounts.map((a) => a.balance_rupiah)) : "0";
  return (
    <section aria-labelledby="balance-title" className="rounded-3xl border border-rule bg-paper-raised p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="balance-title" className="font-semibold">
            Saldo saat ini
          </h2>
          <p className="text-xs text-ink-faint">Tidak terpengaruh pilihan bulan. Termasuk dompet arsip.</p>
        </div>
        {accounts ? <p className="figure text-2xl font-semibold">{formatRupiah(total)}</p> : null}
      </div>
      {error ? <Notice tone="error" className="mt-3">{errorMessage(error)}</Notice> : null}
      {loading ? <Skeleton className="mt-4 h-24" /> : null}
      {accounts ? (
        <ul className="mt-4 divide-y divide-rule">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {a.name}
                  {a.archived_at ? <span className="ml-2 rounded-full bg-paper-sunken px-2 py-0.5 text-xs text-ink-faint">Arsip</span> : null}
                </p>
                <p className="text-xs text-ink-faint">{ACCOUNT_TYPE_LABEL[a.type]}</p>
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
