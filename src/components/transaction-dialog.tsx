"use client";

import { createContext, use, useCallback, useMemo, useState } from "react";

import type { Transaction, TransactionRow, TransactionType } from "@/lib/api/api-types";
import { formatRupiah } from "@/lib/money-utils";

import { useI18n } from "./i18n-provider";
import { TransactionAudit } from "./transaction-audit";
import { TransactionForm } from "./transaction-form";
import { Dialog } from "./ui/dialog";

type OpenArgs = { transaction?: TransactionRow | Transaction; type?: TransactionType };

type Ctx = { openTransaction: (args?: OpenArgs) => void };

const TransactionDialogContext = createContext<Ctx | null>(null);

export function TransactionDialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<(OpenArgs & { key: number }) | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const { t } = useI18n();

  const openTransaction = useCallback((args: OpenArgs = {}) => {
    // A fresh key remounts the form, which also issues a fresh client ID.
    setState({ ...args, key: Date.now() });
  }, []);

  const value = useMemo(() => ({ openTransaction }), [openTransaction]);
  const editing = state?.transaction;

  return (
    <TransactionDialogContext value={value}>
      {children}
      <Dialog
        open={!!state}
        onClose={() => setState(null)}
        title={editing ? t.transactionDialog.editTitle : t.transactionDialog.addTitle}
        description={
          // Names come only with history rows.
          editing && "created_by_name" in editing ? <TransactionAudit row={editing} detailed /> : undefined
        }
      >
        {state ? (
          <TransactionForm
            key={state.key}
            transaction={state.transaction}
            defaultType={state.type}
            onDone={({ action, transaction }) => {
              setState(null);
              setToast(t.transactionDialog.done[action](formatRupiah(transaction.amount_rupiah)));
              window.setTimeout(() => setToast(null), 3500);
            }}
          />
        ) : null}
      </Dialog>
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 md:bottom-8">
        {toast ? (
          <p className="rise rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-paper shadow-lg">{toast}</p>
        ) : null}
      </div>
    </TransactionDialogContext>
  );
}

export function useTransactionDialog(): Ctx {
  const ctx = use(TransactionDialogContext);
  if (!ctx) throw new Error("useTransactionDialog must be used inside TransactionDialogProvider");
  return ctx;
}
