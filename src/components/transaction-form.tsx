"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { useAccounts, useCategories, useInvalidateUserData } from "@/hooks/use-budget-data";
import { ApiError, NetworkError, SessionExpiredError, errorMessage } from "@/lib/api/api-errors";
import type { Account, Transaction, TransactionInput, TransactionRow, TransactionType } from "@/lib/api/api-types";
import { createTransaction, deleteTransaction, getTransaction, updateTransaction } from "@/lib/api/budget-service";
import { formatDateLong, isIsoDate, todayJakarta } from "@/lib/date-utils";
import { formatRupiah, validateRupiah } from "@/lib/money-utils";

import { Button } from "./ui/button";
import { Field, inputClass } from "./ui/field";
import { MoneyInput } from "./ui/money-input";
import { Notice } from "./ui/notice";
import { Segmented } from "./ui/segmented";

const TYPE_OPTIONS = [
  { value: "expense", label: "Pengeluaran" },
  { value: "income", label: "Pemasukan" },
  { value: "transfer", label: "Transfer" },
] as const;

const AMOUNT_MESSAGES = {
  empty: "Nominal wajib diisi.",
  invalid: "Nominal harus angka rupiah bulat.",
  not_positive: "Nominal harus lebih dari nol.",
  too_large: "Nominal terlalu besar.",
} as const;

function buildSchema(accounts: Account[], today: string) {
  const openedOn = (id: string) => accounts.find((a) => a.id === id)?.opened_on;
  return z
    .object({
      type: z.enum(["expense", "income", "transfer"]),
      amount: z.string(),
      account_id: z.string().min(1, "Pilih dompet."),
      to_account_id: z.string(),
      category_id: z.string(),
      occurred_on: z.string(),
      note: z.string().max(250, "Catatan maksimal 250 karakter."),
    })
    .superRefine((v, ctx) => {
      const amount = validateRupiah(v.amount);
      if (!amount.ok) ctx.addIssue({ code: "custom", path: ["amount"], message: AMOUNT_MESSAGES[amount.reason] });
      if (!isIsoDate(v.occurred_on)) {
        ctx.addIssue({ code: "custom", path: ["occurred_on"], message: "Tanggal tidak valid." });
      } else if (v.occurred_on > today) {
        ctx.addIssue({ code: "custom", path: ["occurred_on"], message: "Tanggal tidak boleh melewati hari ini." });
      } else {
        for (const id of v.type === "transfer" ? [v.account_id, v.to_account_id] : [v.account_id]) {
          const opened = id ? openedOn(id) : undefined;
          if (opened && v.occurred_on < opened) {
            ctx.addIssue({
              code: "custom",
              path: ["occurred_on"],
              message: `Tanggal mendahului tanggal mulai dompet (${formatDateLong(opened)}).`,
            });
            break;
          }
        }
      }
      if (v.type === "transfer") {
        if (!v.to_account_id) ctx.addIssue({ code: "custom", path: ["to_account_id"], message: "Pilih dompet tujuan." });
        else if (v.to_account_id === v.account_id)
          ctx.addIssue({ code: "custom", path: ["to_account_id"], message: "Dompet asal dan tujuan harus berbeda." });
      } else if (!v.category_id) {
        ctx.addIssue({ code: "custom", path: ["category_id"], message: "Pilih kategori." });
      }
    });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

type SubmitState =
  | { kind: "idle" }
  | { kind: "uncertain"; message: string }
  | { kind: "error"; message: string; conflict?: boolean };

type TransactionFormProps = {
  /** Present when editing. */
  transaction?: TransactionRow | Transaction;
  defaultType?: TransactionType;
  onDone: (result: { action: "created" | "updated" | "deleted"; transaction: Transaction }) => void;
};

function pickDefaultAccount(accounts: Account[]): string {
  const active = accounts.filter((a) => !a.archived_at);
  const lastUsed = [...active]
    .filter((a) => a.last_used_at)
    .sort((a, b) => (b.last_used_at ?? "").localeCompare(a.last_used_at ?? ""))[0];
  return (lastUsed ?? active[0])?.id ?? "";
}

export function TransactionForm(props: TransactionFormProps) {
  const accounts = useAccounts();
  const categories = useCategories();

  if (accounts.isPending || categories.isPending) {
    return <p className="py-10 text-center text-sm text-ink-soft">Memuat dompet dan kategori…</p>;
  }
  if (accounts.isError || categories.isError) {
    return (
      <Notice tone="error" title="Gagal memuat data">
        {errorMessage(accounts.error ?? categories.error)}
      </Notice>
    );
  }
  return <TransactionFormInner {...props} accounts={accounts.data} categories={categories.data} />;
}

function TransactionFormInner({
  transaction,
  defaultType = "expense",
  onDone,
  accounts,
  categories,
}: TransactionFormProps & { accounts: Account[]; categories: NonNullable<ReturnType<typeof useCategories>["data"]> }) {
  const invalidate = useInvalidateUserData();
  const today = todayJakarta();
  const isEdit = !!transaction;
  // One client ID per form instance; reused on every retry so the server can
  // deduplicate double clicks and lost responses.
  const [clientId] = useState(() => crypto.randomUUID());
  const [version, setVersion] = useState(transaction?.version ?? 0);
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const [busy, setBusy] = useState<false | "save" | "check" | "delete" | "reload">(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const schema = useMemo(() => buildSchema(accounts, today), [accounts, today]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: transaction
      ? {
          type: transaction.type,
          amount: transaction.amount_rupiah,
          account_id: transaction.account_id,
          to_account_id: transaction.to_account_id ?? "",
          category_id: transaction.category_id ?? "",
          occurred_on: transaction.occurred_on,
          note: transaction.note,
        }
      : {
          type: defaultType,
          amount: "",
          account_id: pickDefaultAccount(accounts),
          to_account_id: "",
          category_id: "",
          occurred_on: today,
          note: "",
        },
  });
  const { register, control, handleSubmit, formState, setValue, setError, reset } = form;
  const type = useWatch({ control, name: "type" });
  const accountId = useWatch({ control, name: "account_id" });
  const note = useWatch({ control, name: "note" });

  // Archived options are only offered when the edited transaction already uses them.
  const accountOptions = accounts.filter(
    (a) => !a.archived_at || a.id === transaction?.account_id || a.id === transaction?.to_account_id,
  );
  const categoryOptions = categories.filter(
    (c) => c.type === type && (!c.archived_at || c.id === transaction?.category_id),
  );
  const minDate = accounts.find((a) => a.id === accountId)?.opened_on;

  function toInput(v: FormValues): TransactionInput {
    const amount = validateRupiah(v.amount);
    return {
      type: v.type,
      amount_rupiah: amount.ok ? amount.value : v.amount,
      account_id: v.account_id,
      to_account_id: v.type === "transfer" ? v.to_account_id : null,
      category_id: v.type === "transfer" ? null : v.category_id,
      occurred_on: v.occurred_on,
      note: v.note.trim(),
    };
  }

  function handleFailure(error: unknown) {
    if (error instanceof NetworkError) {
      setSubmitState({
        kind: "uncertain",
        message: isEdit
          ? "Perubahan belum dapat dipastikan tersimpan. Periksa koneksi lalu coba lagi."
          : "Transaksi belum dapat dipastikan tersimpan. Data form tetap di sini; periksa status sebelum mengirim ulang.",
      });
      return;
    }
    if (error instanceof SessionExpiredError) {
      setSubmitState({ kind: "error", message: error.message });
      return;
    }
    if (error instanceof ApiError) {
      if (error.field) {
        const field = error.field === "amount" ? "amount" : (error.field as keyof FormValues);
        setError(field, { message: error.message }, { shouldFocus: true });
        setSubmitState({ kind: "idle" });
        return;
      }
      setSubmitState({
        kind: "error",
        message: error.message,
        conflict: error.code === "VERSION_CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT",
      });
      if (error.code === "VERSION_CONFLICT" || error.code === "NOT_FOUND") void invalidate();
      return;
    }
    setSubmitState({ kind: "error", message: errorMessage(error) });
  }

  async function save(values: FormValues) {
    setBusy("save");
    setSubmitState({ kind: "idle" });
    try {
      const input = toInput(values);
      const saved = isEdit
        ? await updateTransaction(transaction.id, version, input)
        : await createTransaction(clientId, input);
      await invalidate();
      onDone({ action: isEdit ? "updated" : "created", transaction: saved });
    } catch (error) {
      handleFailure(error);
    } finally {
      setBusy(false);
    }
  }

  /** After an uncertain create: look the ID up before sending again. */
  async function checkStatus() {
    setBusy("check");
    try {
      const existing = await getTransaction(clientId);
      if (existing) {
        await invalidate();
        onDone({ action: "created", transaction: existing });
        return;
      }
      setSubmitState({ kind: "idle" });
      await handleSubmit(save)();
    } catch (error) {
      handleFailure(error);
    } finally {
      setBusy(false);
    }
  }

  async function reloadLatest() {
    if (!transaction) return;
    setBusy("reload");
    try {
      const latest = await getTransaction(transaction.id);
      if (!latest) {
        setSubmitState({ kind: "error", message: "Transaksi ini sudah dihapus di perangkat lain." });
        return;
      }
      setVersion(latest.version);
      reset({
        type: latest.type,
        amount: latest.amount_rupiah,
        account_id: latest.account_id,
        to_account_id: latest.to_account_id ?? "",
        category_id: latest.category_id ?? "",
        occurred_on: latest.occurred_on,
        note: latest.note,
      });
      setSubmitState({ kind: "idle" });
    } catch (error) {
      handleFailure(error);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!transaction) return;
    setBusy("delete");
    try {
      const deleted = await deleteTransaction(transaction.id, version);
      await invalidate();
      onDone({ action: "deleted", transaction: deleted });
    } catch (error) {
      setConfirmDelete(false);
      handleFailure(error);
    } finally {
      setBusy(false);
    }
  }

  if (confirmDelete && transaction) {
    return (
      <div className="flex flex-col gap-5">
        <p className="text-ink-soft">
          Hapus {transaction.type === "transfer" ? "transfer" : transaction.type === "income" ? "pemasukan" : "pengeluaran"}{" "}
          <strong className="figure text-ink">{formatRupiah(transaction.amount_rupiah)}</strong> pada{" "}
          <strong className="text-ink">{formatDateLong(transaction.occurred_on)}</strong>? Transaksi yang dihapus tidak masuk
          laporan{transaction.type === "transfer" ? " dan kedua saldo dompet akan dikembalikan" : ""}.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={!!busy}>
            Batal
          </Button>
          <Button variant="danger" onClick={remove} pending={busy === "delete"}>
            Hapus
          </Button>
        </div>
      </div>
    );
  }

  const errors = formState.errors;
  const disabled = !!busy;

  return (
    <form onSubmit={handleSubmit(save)} noValidate className="flex flex-col gap-4">
      <Controller
        control={control}
        name="type"
        render={({ field }) => (
          <Segmented
            label="Jenis transaksi"
            value={field.value}
            options={TYPE_OPTIONS}
            disabled={isEdit}
            onChange={(v) => {
              field.onChange(v);
              setValue("category_id", "");
              setValue("to_account_id", "");
            }}
          />
        )}
      />
      {isEdit ? (
        <p className="-mt-2 text-xs text-ink-faint">Jenis tidak dapat diubah. Hapus lalu buat transaksi baru bila perlu.</p>
      ) : null}

      <Field label="Nominal" error={errors.amount?.message}>
        {(a11y) => (
          <Controller
            control={control}
            name="amount"
            render={({ field }) => (
              <MoneyInput
                {...a11y}
                large
                autoFocus={!isEdit}
                placeholder="0"
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                disabled={disabled}
              />
            )}
          />
        )}
      </Field>

      <div className={type === "transfer" ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : "grid grid-cols-1 gap-4"}>
        <Field label={type === "transfer" ? "Dari dompet" : "Dompet"} error={errors.account_id?.message}>
          {(a11y) => (
            <select {...a11y} {...register("account_id")} className={inputClass} disabled={disabled}>
              <option value="">Pilih dompet</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.archived_at ? " (arsip)" : ""}
                </option>
              ))}
            </select>
          )}
        </Field>
        {type === "transfer" ? (
          <Field label="Ke dompet" error={errors.to_account_id?.message}>
            {(a11y) => (
              <select {...a11y} {...register("to_account_id")} className={inputClass} disabled={disabled}>
                <option value="">Pilih dompet</option>
                {accountOptions
                  .filter((a) => a.id !== accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.archived_at ? " (arsip)" : ""}
                    </option>
                  ))}
              </select>
            )}
          </Field>
        ) : (
          <Field label="Kategori" error={errors.category_id?.message}>
            {(a11y) => (
              <select {...a11y} {...register("category_id")} className={inputClass} disabled={disabled}>
                <option value="">Pilih kategori</option>
                {categoryOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.archived_at ? " (arsip)" : ""}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
      </div>

      <Field label="Tanggal" error={errors.occurred_on?.message}>
        {(a11y) => (
          <input
            {...a11y}
            type="date"
            max={today}
            min={minDate}
            {...register("occurred_on")}
            className={inputClass}
            disabled={disabled}
          />
        )}
      </Field>

      <Field
        label="Catatan (opsional)"
        error={errors.note?.message}
        hint={<span aria-live="polite">{note.length}/250</span>}
      >
        {(a11y) => (
          <textarea
            {...a11y}
            rows={2}
            maxLength={250}
            {...register("note")}
            placeholder="Misalnya: makan siang"
            className={`${inputClass} h-auto py-2.5`}
            disabled={disabled}
          />
        )}
      </Field>

      {type === "transfer" ? (
        <p className="text-xs text-ink-faint">Transfer tidak dihitung sebagai pemasukan atau pengeluaran. Catat biaya admin sebagai pengeluaran terpisah.</p>
      ) : null}

      {submitState.kind === "uncertain" ? (
        <Notice
          tone="warn"
          title="Belum dapat dipastikan"
          action={
            isEdit ? (
              <Button size="sm" onClick={handleSubmit(save)} pending={busy === "save"}>
                Coba lagi
              </Button>
            ) : (
              <Button size="sm" onClick={checkStatus} pending={busy === "check"}>
                Periksa &amp; kirim ulang
              </Button>
            )
          }
        >
          {submitState.message}
        </Notice>
      ) : null}
      {submitState.kind === "error" ? (
        <Notice
          tone="error"
          action={
            submitState.conflict && isEdit ? (
              <Button size="sm" variant="secondary" onClick={reloadLatest} pending={busy === "reload"}>
                Muat data terbaru
              </Button>
            ) : null
          }
        >
          {submitState.message}
        </Notice>
      ) : null}

      <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row">
        {isEdit ? (
          <Button variant="ghost" className="text-outflow sm:mr-auto" onClick={() => setConfirmDelete(true)} disabled={disabled}>
            Hapus
          </Button>
        ) : null}
        <Button type="submit" size="lg" className="sm:min-w-40" pending={busy === "save"} disabled={disabled}>
          {isEdit ? "Simpan perubahan" : "Simpan"}
        </Button>
      </div>
    </form>
  );
}
