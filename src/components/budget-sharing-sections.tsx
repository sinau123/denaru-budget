"use client";

import { useState } from "react";

import { useActiveBudget, useBudgetSharing, useInvalidateUserData, useSwitchBudget } from "@/hooks/use-budget-data";
import { errorMessage } from "@/lib/api/api-errors";
import type { BudgetMember, SharedBudget } from "@/lib/api/api-types";
import { inviteBudgetMember, removeBudgetMember, respondBudgetInvite } from "@/lib/api/budget-service";

import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Field, inputClass } from "./ui/field";
import { Notice } from "./ui/notice";
import { SettingsSection } from "./ui/settings-section";

/** Runs a sharing action, refreshes data, and keeps the error message. */
function useSharingAction() {
  const invalidate = useInvalidateUserData();
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await invalidate();
      return true;
    } catch (e) {
      setError(errorMessage(e, t));
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, run };
}

/** Pending invitations addressed to the signed-in user. Hidden when there are none. */
export function IncomingInvitesSection() {
  const sharing = useBudgetSharing();
  const { t } = useI18n();
  const s = t.settings;
  const { busy, error, run } = useSharingAction();
  const pending = sharing.data?.shared_with_me.filter((x) => x.status === "pending") ?? [];

  if (!pending.length) return null;
  return (
    <SettingsSection title={s.invitesTitle}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <ul className="divide-y divide-rule rounded-2xl border border-rule" data-testid="incoming-invites">
        {pending.map((invite) => (
          <li key={invite.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-sm">{s.inviteFrom(invite.owner_name, invite.owner_email)}</p>
            <div className="flex gap-2">
              <Button size="sm" pending={busy === `accept:${invite.id}`} onClick={() => run(`accept:${invite.id}`, () => respondBudgetInvite(invite.id, true))}>
                {s.accept}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                pending={busy === `decline:${invite.id}`}
                onClick={() => run(`decline:${invite.id}`, () => respondBudgetInvite(invite.id, false))}
              >
                {s.decline}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </SettingsSection>
  );
}

/**
 * Chooses between the user's own budget and budgets shared with them. Hidden
 * until the user has joined at least one shared budget.
 */
export function ActiveBudgetSection() {
  const budget = useActiveBudget();
  const sharing = useBudgetSharing();
  const switchBudget = useSwitchBudget();
  const { t } = useI18n();
  const s = t.settings;
  const { busy, error, run } = useSharingAction();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState<SharedBudget | null>(null);

  const joined = sharing.data?.shared_with_me.filter((x) => x.status === "accepted") ?? [];
  if (!budget || (budget.is_own && !joined.length)) return null;

  // Keep the current choice selectable even before the sharing list has loaded.
  const options = joined.some((j) => j.owner_id === budget.owner_id) || budget.is_own
    ? joined
    : [{ owner_id: budget.owner_id, owner_name: budget.owner_name }, ...joined];

  return (
    <SettingsSection title={s.budgetTitle} description={s.budgetDescription}>
      <Field label={s.budgetLabel} className="max-w-sm">
        {(field) => (
          <select
            {...field}
            data-testid="active-budget-select"
            className={inputClass}
            value={budget.is_own ? "" : budget.owner_id}
            disabled={switching}
            onChange={async (e) => {
              setSwitching(true);
              setSwitchError(null);
              try {
                await switchBudget(e.target.value || null);
              } catch (err) {
                setSwitchError(errorMessage(err, t));
              } finally {
                setSwitching(false);
              }
            }}
          >
            <option value="">{s.ownBudget}</option>
            {options.map((o) => (
              <option key={o.owner_id} value={o.owner_id}>
                {s.sharedBudget(o.owner_name)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {switchError ? <Notice tone="error">{switchError}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {joined.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink-soft">{s.joinedTitle}</h3>
          <ul className="divide-y divide-rule rounded-2xl border border-rule">
            {joined.map((j) => (
              <li key={j.id} className="flex items-center gap-2 py-2 pl-4 pr-2">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{j.owner_name}</span>{" "}
                  <span className="text-sm text-ink-faint">{j.owner_email}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setConfirmLeave(j)}>
                  {s.leave}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Dialog open={!!confirmLeave} onClose={() => setConfirmLeave(null)} title={s.leaveTitle}>
        {confirmLeave ? (
          <div className="flex flex-col gap-4">
            <p className="text-ink-soft">{s.leaveBody(confirmLeave.owner_name)}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setConfirmLeave(null)}>
                {t.common.cancel}
              </Button>
              <Button
                variant="danger"
                pending={busy === confirmLeave.id}
                onClick={async () => {
                  await run(confirmLeave.id, () => removeBudgetMember(confirmLeave.id));
                  setConfirmLeave(null);
                }}
              >
                {s.leave}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </SettingsSection>
  );
}

/** Invite people to the user's own budget and manage who has access. */
export function ShareBudgetSection() {
  const sharing = useBudgetSharing();
  const { t } = useI18n();
  const s = t.settings;
  const { busy, error, run } = useSharingAction();
  const [email, setEmail] = useState("");
  // Reused on retry so a lost response cannot create a second invite.
  const [inviteId, setInviteId] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<BudgetMember | null>(null);
  const members = sharing.data?.members ?? [];

  return (
    <SettingsSection title={s.shareTitle} description={s.shareDescription}>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async (e) => {
          e.preventDefault();
          const value = email.trim();
          if (!value) return;
          setMessage(null);
          if (await run("invite", () => inviteBudgetMember(inviteId, value))) {
            setMessage(s.invited(value.toLowerCase()));
            setEmail("");
            setInviteId(crypto.randomUUID());
          }
        }}
      >
        <label className="flex-1">
          <span className="sr-only">{s.inviteEmail}</span>
          <input
            type="email"
            required
            autoComplete="off"
            data-testid="invite-email"
            value={email}
            maxLength={254}
            onChange={(e) => {
              setEmail(e.target.value);
              setInviteId(crypto.randomUUID());
            }}
            placeholder={s.invitePlaceholder}
            className={inputClass}
          />
        </label>
        <Button type="submit" pending={busy === "invite"}>
          {s.invite}
        </Button>
      </form>
      {message ? <p role="status" className="text-sm text-accent">{message}</p> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {sharing.isError ? <Notice tone="error">{errorMessage(sharing.error, t)}</Notice> : null}

      {members.length ? (
        <ul className="divide-y divide-rule rounded-2xl border border-rule" data-testid="budget-members">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 py-2 pl-4 pr-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{m.email}</span>
                <span className="text-xs text-ink-faint">{m.status === "accepted" ? s.memberAccepted : s.memberPending}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(m)}>
                {m.status === "accepted" ? s.removeMember : s.cancelInvite}
              </Button>
            </li>
          ))}
        </ul>
      ) : sharing.isSuccess ? (
        <p className="text-sm text-ink-faint">{s.noMembers}</p>
      ) : null}

      <Dialog open={!!confirmRemove} onClose={() => setConfirmRemove(null)} title={s.removeTitle}>
        {confirmRemove ? (
          <div className="flex flex-col gap-4">
            <p className="text-ink-soft">{s.removeBody(confirmRemove.email)}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setConfirmRemove(null)}>
                {t.common.cancel}
              </Button>
              <Button
                variant="danger"
                pending={busy === confirmRemove.id}
                onClick={async () => {
                  await run(confirmRemove.id, () => removeBudgetMember(confirmRemove.id));
                  setConfirmRemove(null);
                }}
              >
                {confirmRemove.status === "accepted" ? s.removeMember : s.cancelInvite}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </SettingsSection>
  );
}
