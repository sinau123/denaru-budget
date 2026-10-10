"use client";

import { useState } from "react";

import { errorMessage } from "@/lib/api/api-errors";
import type { TransactionFilters } from "@/lib/api/api-types";
import { downloadCsv, exportTransactionsCsv } from "@/lib/api/export-service";
import { todayJakarta } from "@/lib/date-utils";

import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import { Notice } from "./ui/notice";

export function ExportButton({ filters, label }: { filters: TransactionFilters; label?: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<{ kind: "idle" | "busy" } | { kind: "done"; count: number } | { kind: "error"; message: string }>({
    kind: "idle",
  });

  async function run() {
    setState({ kind: "busy" });
    try {
      const { csv, count } = await exportTransactionsCsv(filters);
      downloadCsv(csv, `denaru-transaksi-${todayJakarta()}.csv`);
      setState({ kind: "done", count });
    } catch (error) {
      // No file is produced when any page fails or data changed mid-export.
      setState({ kind: "error", message: errorMessage(error, t) });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" onClick={run} pending={state.kind === "busy"}>
        {label ?? t.exportCsv.label}
      </Button>
      {state.kind === "done" ? (
        <p role="status" className="text-xs text-ink-soft">
          {t.exportCsv.done(state.count)}
        </p>
      ) : null}
      {state.kind === "error" ? <Notice tone="error">{state.message} {t.exportCsv.notCreated}</Notice> : null}
    </div>
  );
}
