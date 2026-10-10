"use client";

import Link from "next/link";
import { useState } from "react";

import { useAccounts, useInvalidateUserData } from "@/hooks/use-budget-data";
import { errorMessage } from "@/lib/api/api-errors";
import type { Account } from "@/lib/api/api-types";
import { deleteAccount, setAccountArchived } from "@/lib/api/budget-service";
import { formatDateLong } from "@/lib/date-utils";
import { formatRupiah, sumRupiah } from "@/lib/money-utils";

import { AccountForm } from "../account-form";
import { useTransactionDialog } from "../transaction-dialog";
import { Button } from "../ui/button";
import { cx } from "../ui/cx";
import { Dialog } from "../ui/dialog";
import { Notice, Skeleton } from "../ui/notice";
import { ACCOUNT_TYPE_LABEL } from "./dashboard-screen";

export function WalletsScreen() {
  const accounts = useAccounts();
  const invalidate = useInvalidateUserData();
  const { openTransaction } = useTransactionDialog();
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null);

  const list = accounts.data ?? [];
  const active = list.filter((a) => !a.archived_at);
  const archived = list.filter((a) => a.archived_at);
  const total = sumRupiah(list.map((a) => a.balance_rupiah));

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setActionError(null);
    try {
      await action();
      await invalidate();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="figure text-3xl font-semibold sm:text-4xl">Dompet</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Total saldo saat ini <strong className="figure text-ink">{formatRupiah(total)}</strong>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => openTransaction({ type: "transfer" })} disabled={active.length < 2}>
            Transfer
          </Button>
          <Button onClick={() => setEditing("new")}>Dompet baru</Button>
        </div>
      </header>

      {accounts.isError ? <Notice tone="error">{errorMessage(accounts.error)}</Notice> : null}
      {actionError ? <Notice tone="error">{actionError}</Notice> : null}
      {accounts.isPending ? <Skeleton className="h-40" /> : null}

      <ul className="grid gap-3 sm:grid-cols-2">
        {active.map((a, i) => (
          <WalletCard key={a.id} account={a} index={i}>
            <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
              Ubah
            </Button>
            <Button size="sm" variant="ghost" pending={busyId === a.id} onClick={() => run(a.id, () => setAccountArchived(a.id, true))}>
              Arsipkan
            </Button>
            {a.transaction_count === 0 ? (
              <Button size="sm" variant="ghost" className="text-outflow" onClick={() => setConfirmDelete(a)}>
                Hapus
              </Button>
            ) : null}
          </WalletCard>
        ))}
      </ul>

      {archived.length ? (
        <section aria-labelledby="archived-title" className="flex flex-col gap-3">
          <div>
            <h2 id="archived-title" className="font-semibold">
              Diarsipkan
            </h2>
            <p className="text-xs text-ink-faint">Tetap masuk riwayat dan total saldo, tetapi tidak bisa dipilih untuk transaksi baru.</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {archived.map((a, i) => (
              <WalletCard key={a.id} account={a} index={i} muted>
                <Button size="sm" variant="secondary" pending={busyId === a.id} onClick={() => run(a.id, () => setAccountArchived(a.id, false))}>
                  Aktifkan lagi
                </Button>
              </WalletCard>
            ))}
          </ul>
        </section>
      ) : null}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Dompet baru" : "Ubah dompet"}>
        {editing ? (
          <AccountForm
            key={editing === "new" ? "new" : editing.id}
            account={editing === "new" ? undefined : editing}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Dialog>

      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Hapus dompet?">
        {confirmDelete ? (
          <div className="flex flex-col gap-4">
            <p className="text-ink-soft">
              Dompet <strong className="text-ink">{confirmDelete.name}</strong> belum memiliki transaksi dan akan dihapus permanen.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                Batal
              </Button>
              <Button
                variant="danger"
                pending={busyId === confirmDelete.id}
                onClick={async () => {
                  await run(confirmDelete.id, () => deleteAccount(confirmDelete.id));
                  setConfirmDelete(null);
                }}
              >
                Hapus
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function WalletCard({ account, index, muted, children }: { account: Account; index: number; muted?: boolean; children: React.ReactNode }) {
  const negative = account.balance_rupiah.startsWith("-");
  return (
    <li
      className={cx("rise flex flex-col gap-4 rounded-3xl border border-rule bg-paper-raised p-5", muted && "opacity-75")}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{account.name}</p>
          <p className="text-xs text-ink-faint">
            {ACCOUNT_TYPE_LABEL[account.type]} · mulai {formatDateLong(account.opened_on)}
          </p>
        </div>
        <Link href={`/transaksi?bulan=semua&dompet=${account.id}`} className="shrink-0 text-sm font-semibold text-accent hover:underline">
          Riwayat
        </Link>
      </div>
      <div>
        <p className="text-xs text-ink-faint">Saldo saat ini</p>
        <p className={cx("figure text-3xl font-semibold [overflow-wrap:anywhere]", negative && "text-outflow")}>{formatRupiah(account.balance_rupiah)}</p>
        <p className="mt-1 text-xs text-ink-faint">
          Saldo awal {formatRupiah(account.opening_balance_rupiah)} · {account.transaction_count} transaksi
        </p>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </li>
  );
}
