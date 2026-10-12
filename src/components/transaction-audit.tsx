"use client";

import type { TransactionRow } from "@/lib/api/api-types";
import { formatDateTime } from "@/lib/date-utils";

import { useUserId } from "./auth-provider";
import { useI18n } from "./i18n-provider";

type AuditRow = Pick<TransactionRow, "created_by" | "created_by_name" | "updated_by" | "updated_by_name" | "updated_at">;

/**
 * "Recorded by X · edited by Y". Only rendered when someone other than the
 * viewer recorded or edited the transaction (shared budgets), so people who
 * keep their books alone never see it. `detailed` adds the time of the edit.
 */
export function TransactionAudit({ row, detailed, className }: { row: AuditRow; detailed?: boolean; className?: string }) {
  const userId = useUserId();
  const { t, locale } = useI18n();
  const tx = t.transactions;
  const isOther = (id: string | null) => !!id && id !== userId;
  if (!isOther(row.created_by) && !isOther(row.updated_by)) return null;

  const who = (id: string | null, name: string | null) => (id === userId ? tx.you : name || tx.formerMember);
  const parts: string[] = [];
  if (row.created_by) parts.push(tx.recordedBy(who(row.created_by, row.created_by_name)));
  if (row.updated_by) {
    const editor = who(row.updated_by, row.updated_by_name);
    parts.push(detailed ? tx.lastEditedBy(editor, formatDateTime(row.updated_at, locale)) : tx.editedBy(editor));
  }
  const text = parts.join(" · ");
  return <p className={className}>{text.charAt(0).toUpperCase() + text.slice(1)}</p>;
}
