"use client";

import type { TransactionRow } from "@/lib/api/api-types";
import { relativeDayLabel, todayJakarta } from "@/lib/date-utils";
import { formatRupiah, sumRupiah } from "@/lib/money-utils";

import { cx } from "./ui/cx";

/** History grouped by day. Notes are rendered as plain text only. */
export function TransactionList({ rows, onSelect }: { rows: TransactionRow[]; onSelect: (row: TransactionRow) => void }) {
  const today = todayJakarta();
  const groups: { date: string; rows: TransactionRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last?.date === row.occurred_on) last.rows.push(row);
    else groups.push({ date: row.occurred_on, rows: [row] });
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => {
        const net = sumRupiah(
          g.rows.filter((r) => r.type !== "transfer").map((r) => (r.type === "expense" ? `-${r.amount_rupiah}` : r.amount_rupiah)),
        );
        return (
          <section key={g.date} aria-label={relativeDayLabel(g.date, today)}>
            <div className="mb-1.5 flex items-baseline justify-between px-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              <h3>{relativeDayLabel(g.date, today)}</h3>
              <span className="figure normal-case tracking-normal">{formatRupiah(net, { signed: true })}</span>
            </div>
            <ul className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-paper-raised">
              {g.rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(r)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-paper-sunken"
                  >
                    <TypeMark type={r.type} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {r.type === "transfer" ? `${r.account_name} → ${r.to_account_name}` : r.category_name}
                      </p>
                      <p className="truncate text-sm text-ink-faint">
                        {r.type === "transfer" ? "Transfer" : r.account_name}
                        {r.note ? ` · ${r.note}` : ""}
                      </p>
                    </div>
                    <p
                      className={cx(
                        "figure shrink-0 text-right font-semibold",
                        r.type === "income" && "text-inflow",
                        r.type === "transfer" && "text-ink-soft",
                      )}
                    >
                      {r.type === "income" ? "+" : r.type === "expense" ? "−" : ""}
                      {formatRupiah(r.amount_rupiah)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function TypeMark({ type }: { type: TransactionRow["type"] }) {
  const label = type === "income" ? "Pemasukan" : type === "expense" ? "Pengeluaran" : "Transfer";
  return (
    <span
      role="img"
      aria-label={label}
      className={cx(
        "grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold",
        type === "income" && "bg-accent-soft text-inflow",
        type === "expense" && "bg-outflow-soft text-outflow",
        type === "transfer" && "bg-paper-sunken text-ink-soft",
      )}
    >
      {type === "income" ? "↓" : type === "expense" ? "↑" : "⇄"}
    </span>
  );
}
