import type { TransactionRow } from "./api/api-types";

const TYPE_LABEL: Record<TransactionRow["type"], string> = {
  expense: "pengeluaran",
  income: "pemasukan",
  transfer: "transfer",
};

export const CSV_HEADER = [
  "id",
  "tanggal",
  "jenis",
  "sumber",
  "nominal_rupiah",
  "dompet",
  "dompet_tujuan",
  "kategori",
  "catatan",
] as const;

// Spreadsheet apps execute cells starting with these characters as formulas.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: string): string {
  let text = value;
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text) || text !== value) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function transactionToCsvRow(t: TransactionRow): string {
  const cells = [
    t.id,
    t.occurred_on,
    TYPE_LABEL[t.type],
    t.source,
    t.amount_rupiah, // plain digits, no thousands separator
    t.account_name,
    t.to_account_name ?? "",
    t.category_name ?? "",
    t.note,
  ];
  return cells.map((c) => escapeCsvCell(String(c))).join(",");
}

export function buildCsv(rows: readonly TransactionRow[]): string {
  // BOM so spreadsheet apps read UTF-8 correctly; CRLF per RFC 4180.
  return `﻿${[CSV_HEADER.join(","), ...rows.map(transactionToCsvRow)].join("\r\n")}\r\n`;
}
