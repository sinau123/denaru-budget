import { buildCsv } from "../csv-utils";
import { ApiError } from "./api-errors";
import { callRpc } from "./rpc-client";
import type { Profile, TransactionFilters, TransactionRow } from "./api-types";
import { EXPORT_PAGE_SIZE, cursorOf, exportTransactionsPage } from "./budget-service";

export class ExportChangedError extends ApiError {
  constructor() {
    super("EXPORT_CHANGED");
  }
}

/**
 * Reads every page of the filtered history and only then builds the CSV.
 * Any failed page throws, so a partial file is never produced. The profile's
 * data_version is compared before and after to detect concurrent changes.
 */
export async function exportTransactionsCsv(filters: TransactionFilters): Promise<{ csv: string; count: number }> {
  const before = await callRpc<Profile>("get_profile");
  const rows: TransactionRow[] = [];
  let page = await exportTransactionsPage(filters, null);
  rows.push(...page);
  while (page.length === EXPORT_PAGE_SIZE) {
    page = await exportTransactionsPage(filters, cursorOf(page[page.length - 1]));
    rows.push(...page);
  }
  const after = await callRpc<Profile>("get_profile");
  if (before.data_version !== after.data_version) throw new ExportChangedError();
  return { csv: buildCsv(rows), count: rows.length };
}

export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
