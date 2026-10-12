"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useTelegramStatus } from "@/hooks/use-budget-data";
import { errorMessage } from "@/lib/api/api-errors";
import type { TelegramStatus } from "@/lib/api/api-types";
import {
  confirmTelegramLink,
  createTelegramLinkToken,
  rejectTelegramLink,
  setTelegramBudget,
  setTelegramDefaultAccount,
  unlinkTelegram,
} from "@/lib/api/budget-service";
import { queryKeys } from "@/lib/api/query-keys";

import { useUserId } from "./auth-provider";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Field, inputClass } from "./ui/field";
import { Notice } from "./ui/notice";
import { SettingsSection } from "./ui/settings-section";

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

/** "@budi (Budi)", "@budi", "Budi", or a generic label. */
function identity(username: string, firstName: string, fallback: string) {
  if (username) return firstName ? `@${username} (${firstName})` : `@${username}`;
  return firstName || fallback;
}

/** Seconds left until `expiresAt`, ticking every second. */
function useSecondsLeft(expiresAt: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return 0;
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
}

const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Settings → Telegram: pairing (PRD F11), budget and default wallet for chat, disconnect. */
export function TelegramSection() {
  const { t } = useI18n();
  const s = t.settings;
  const userId = useUserId();
  const queryClient = useQueryClient();
  const status = useTelegramStatus(Boolean(BOT_USERNAME));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // The raw code is only known right after creating it.
  const [code, setCode] = useState<{ tokenId: string; code: string } | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const pending = status.data?.pending ?? null;
  const link = status.data?.link ?? null;
  const secondsLeft = useSecondsLeft(pending?.expires_at ?? null);

  // Reload once the code runs out; the server then reports no pending code,
  // which also hides the stale deep link.
  useEffect(() => {
    if (pending && secondsLeft === 0) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.telegram(userId) });
    }
  }, [pending, secondsLeft, queryClient, userId]);

  async function run(key: string, fn: () => Promise<TelegramStatus | void>) {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const next = await fn();
      if (next) queryClient.setQueryData(queryKeys.telegram(userId), next);
      else await queryClient.invalidateQueries({ queryKey: queryKeys.telegram(userId) });
      return true;
    } catch (e) {
      setError(errorMessage(e, t));
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (!BOT_USERNAME) {
    return (
      <SettingsSection title={s.telegramTitle} description={s.telegramDescription}>
        <Notice>{s.telegramNotConfigured}</Notice>
      </SettingsSection>
    );
  }

  const startPairing = () =>
    run("connect", async () => {
      const token = await createTelegramLinkToken();
      setCode({ tokenId: token.id, code: token.code });
    });

  return (
    <SettingsSection title={s.telegramTitle} description={s.telegramDescription}>
      {status.isError ? <Notice tone="error">{errorMessage(status.error, t)}</Notice> : null}

      {link ? (
        <ConnectedView
          link={link}
          busy={busy}
          onBudgetChange={(ownerId) =>
            run("budget", async () => {
              const next = await setTelegramBudget(ownerId);
              setMessage(s.telegramBudgetSaved);
              return next;
            })
          }
          onDefaultChange={(accountId) =>
            run("default", async () => {
              const next = await setTelegramDefaultAccount(accountId);
              setMessage(s.telegramDefaultSaved);
              return next;
            })
          }
          onDisconnect={() => setConfirmUnlink(true)}
        />
      ) : null}

      {pending?.claimed ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-rule p-4" data-testid="telegram-approve">
          <p className="font-semibold">{s.telegramApproveTitle}</p>
          <p className="text-sm text-ink-soft">
            {s.telegramApproveBody(identity(pending.username, pending.first_name, s.telegramUnknownUser))}
          </p>
          <p className="text-xs text-ink-faint">{s.telegramExpiresIn(mmss(secondsLeft))}</p>
          <div className="flex gap-2">
            <Button pending={busy === "approve"} onClick={() => run("approve", () => confirmTelegramLink(pending.id))}>
              {s.telegramApprove}
            </Button>
            <Button variant="ghost" pending={busy === "reject"} onClick={() => run("reject", () => rejectTelegramLink(pending.id))}>
              {s.telegramReject}
            </Button>
          </div>
        </div>
      ) : pending && code?.tokenId === pending.id ? (
        <div className="flex flex-col gap-2" data-testid="telegram-pairing">
          <a
            href={`https://t.me/${BOT_USERNAME}?start=${code.code}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 w-fit items-center justify-center rounded-xl bg-accent px-4 font-semibold text-accent-ink hover:brightness-110"
          >
            {s.telegramOpenBot}
          </a>
          <p className="text-sm text-ink-soft">{s.telegramOpenHint}</p>
          <p role="status" className="text-xs text-ink-faint">
            {s.telegramWaiting} {s.telegramExpiresIn(mmss(secondsLeft))}
          </p>
        </div>
      ) : !link ? (
        <div>
          <Button pending={busy === "connect"} onClick={startPairing} data-testid="telegram-connect">
            {pending ? s.telegramNewLink : s.telegramConnect}
          </Button>
        </div>
      ) : null}

      {message ? <p role="status" className="text-sm text-accent">{message}</p> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Dialog open={confirmUnlink} onClose={() => setConfirmUnlink(false)} title={s.telegramDisconnectTitle}>
        <div className="flex flex-col gap-4">
          <p className="text-ink-soft">{s.telegramDisconnectBody}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirmUnlink(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="danger"
              pending={busy === "unlink"}
              onClick={async () => {
                await run("unlink", unlinkTelegram);
                setConfirmUnlink(false);
              }}
            >
              {s.telegramDisconnect}
            </Button>
          </div>
        </div>
      </Dialog>
    </SettingsSection>
  );
}

function ConnectedView({
  link,
  busy,
  onBudgetChange,
  onDefaultChange,
  onDisconnect,
}: {
  link: NonNullable<TelegramStatus["link"]>;
  busy: string | null;
  onBudgetChange: (ownerId: string | null) => void;
  onDefaultChange: (accountId: string | null) => void;
  onDisconnect: () => void;
}) {
  const { t } = useI18n();
  const s = t.settings;
  // The saved default may have been archived since.
  const value = link.accounts.some((a) => a.id === link.default_account_id) ? (link.default_account_id ?? "") : "";

  return (
    <div className="flex flex-col gap-3" data-testid="telegram-connected">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 font-medium">
          {s.telegramConnectedAs(identity(link.username, link.first_name, s.telegramUnknownUser))}
        </p>
        <Button size="sm" variant="ghost" onClick={onDisconnect}>
          {s.telegramDisconnect}
        </Button>
      </div>
      {link.budgets.length > 1 ? (
        <Field label={s.telegramBudget} hint={s.telegramBudgetHint} className="max-w-sm">
          {(field) => (
            <select
              {...field}
              data-testid="telegram-budget"
              className={inputClass}
              value={link.budget.owner_id}
              disabled={busy === "budget"}
              onChange={(e) => {
                const choice = link.budgets.find((b) => b.owner_id === e.target.value);
                onBudgetChange(choice && !choice.is_own ? choice.owner_id : null);
              }}
            >
              {link.budgets.map((b) => (
                <option key={b.owner_id} value={b.owner_id}>
                  {b.is_own ? s.ownBudget : s.sharedBudget(b.owner_name)}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}
      <Field label={s.telegramDefaultWallet} hint={s.telegramDefaultHint} className="max-w-sm">
        {(field) => (
          <select
            {...field}
            data-testid="telegram-default-wallet"
            className={inputClass}
            value={value}
            disabled={busy === "default" || busy === "budget"}
            onChange={(e) => onDefaultChange(e.target.value || null)}
          >
            <option value="">{s.telegramPickWallet}</option>
            {link.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {!value ? <Notice tone="warn">{s.telegramDefaultMissing}</Notice> : null}
      <p className="text-xs text-ink-faint">{s.telegramCommands}</p>
    </div>
  );
}
