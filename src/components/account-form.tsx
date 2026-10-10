"use client";

import { useState } from "react";

import { useInvalidateUserData } from "@/hooks/use-budget-data";
import { ApiError, NetworkError, errorMessage } from "@/lib/api/api-errors";
import type { Account, AccountType } from "@/lib/api/api-types";
import { type AccountInput, createAccount, updateAccount } from "@/lib/api/budget-service";
import { formatDateLong, isIsoDate, todayJakarta } from "@/lib/date-utils";
import { formatRupiah, validateRupiah } from "@/lib/money-utils";

import { rich, useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import { Field, inputClass } from "./ui/field";
import { MoneyInput } from "./ui/money-input";
import { Notice } from "./ui/notice";
import { Segmented } from "./ui/segmented";

const ACCOUNT_TYPES: readonly AccountType[] = ["cash", "bank", "ewallet"];

type Errors = Partial<Record<"name" | "opening" | "opened_on", string>>;

/**
 * Create or edit a wallet. `clientId` lets callers keep the same ID across
 * retries (onboarding persists it so an interrupted setup never duplicates).
 */
export function AccountForm({
  account,
  clientId,
  submitLabel,
  onDone,
}: {
  account?: Account;
  clientId?: string;
  submitLabel?: string;
  onDone: (account: Pick<Account, "id" | "name">) => void;
}) {
  const invalidate = useInvalidateUserData();
  const { t, locale } = useI18n();
  const f = t.accountForm;
  const today = todayJakarta();
  const [id] = useState(() => account?.id ?? clientId ?? crypto.randomUUID());
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "cash");
  const [opening, setOpening] = useState(account?.opening_balance_rupiah ?? "0");
  const [openedOn, setOpenedOn] = useState(account?.opened_on ?? today);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmOpening, setConfirmOpening] = useState(false);

  const openingChanged = account && opening !== account.opening_balance_rupiah;

  function validate(): AccountInput | null {
    const next: Errors = {};
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 50) next.name = f.errors.name;
    const amount = validateRupiah(opening || "0", { allowNegative: true, allowZero: true });
    if (!amount.ok) next.opening = amount.reason === "too_large" ? f.errors.openingTooLarge : f.errors.openingInvalid;
    if (!isIsoDate(openedOn)) next.opened_on = f.errors.dateInvalid;
    else if (openedOn > today) next.opened_on = f.errors.openedInFuture;
    else if (account?.earliest_occurred_on && openedOn > account.earliest_occurred_on) {
      next.opened_on = f.errors.openedAfterEarliest(formatDateLong(account.earliest_occurred_on, locale));
    }
    setErrors(next);
    if (Object.keys(next).length || !amount.ok) return null;
    return { id, name: trimmed, type, opening_balance_rupiah: amount.value, opened_on: openedOn };
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const input = validate();
    if (!input) return;
    if (openingChanged && !confirmOpening) {
      setConfirmOpening(true);
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      const saved = account ? await updateAccount(input) : await createAccount(input);
      await invalidate();
      onDone(saved);
    } catch (error) {
      if (error instanceof ApiError && error.field) {
        const field = error.field === "opened_on" ? "opened_on" : error.field === "amount" ? "opening" : "name";
        setErrors({ [field]: errorMessage(error, t) });
      } else if (error instanceof NetworkError) {
        setFormError(`${errorMessage(error, t)} ${f.errors.uncertain}`);
      } else {
        setFormError(errorMessage(error, t));
      }
    } finally {
      setPending(false);
      setConfirmOpening(false);
    }
  }

  if (confirmOpening && account) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-ink-soft">
          {rich(f.confirmOpening, {
            name: <strong className="text-ink">{account.name}</strong>,
            from: <strong className="figure text-ink">{formatRupiah(account.opening_balance_rupiah)}</strong>,
            to: <strong className="figure text-ink">{formatRupiah(opening || "0")}</strong>,
            date: formatDateLong(openedOn, locale),
          })}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setConfirmOpening(false)}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => submit()} pending={pending}>
            {f.confirmYes}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label={f.nameLabel} error={errors.name}>
        {(a11y) => (
          <input
            {...a11y}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
            placeholder={f.namePlaceholder}
            className={inputClass}
            autoFocus={!account}
          />
        )}
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink-soft">{t.common.type}</span>
        <Segmented
          label={f.typeLabel}
          value={type}
          options={ACCOUNT_TYPES.map((value) => ({ value, label: t.accountType[value] }))}
          onChange={setType}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={f.openingLabel} error={errors.opening} hint={f.openingHint}>
          {(a11y) => <MoneyInput {...a11y} value={opening} onValueChange={setOpening} allowNegative />}
        </Field>
        <Field label={f.openedOnLabel} error={errors.opened_on}>
          {(a11y) => (
            <input
              {...a11y}
              type="date"
              value={openedOn}
              max={account?.earliest_occurred_on && account.earliest_occurred_on < today ? account.earliest_occurred_on : today}
              onChange={(e) => setOpenedOn(e.target.value)}
              className={inputClass}
            />
          )}
        </Field>
      </div>
      <p className="-mt-1 text-xs text-ink-faint">
        {f.openingNote(isIsoDate(openedOn) ? formatDateLong(openedOn, locale) : null)}
      </p>
      {formError ? <Notice tone="error">{formError}</Notice> : null}
      <Button type="submit" size="lg" pending={pending}>
        {submitLabel ?? (account ? t.common.saveChanges : f.create)}
      </Button>
    </form>
  );
}
