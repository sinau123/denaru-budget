import { describe, expect, it } from "vitest";

import type { TransactionRow } from "./api/api-types";
import { buildCsv, escapeCsvCell } from "./csv-utils";

const base: TransactionRow = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "expense",
  source: "web",
  amount_rupiah: "1250000",
  account_id: "a",
  account_name: "Tunai",
  to_account_id: null,
  to_account_name: null,
  category_id: "c",
  category_name: "Makanan",
  occurred_on: "2026-10-10",
  note: "",
  version: 1,
  created_at: "2026-10-10T01:00:00Z",
  updated_at: "2026-10-10T01:00:00Z",
};

describe("csv-utils", () => {
  it("escapes commas, quotes and newlines", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('kata "kutip"')).toBe('"kata ""kutip"""');
    expect(escapeCsvCell("baris\nbaru")).toBe('"baris\nbaru"');
    expect(escapeCsvCell("biasa")).toBe("biasa");
  });

  it("neutralizes spreadsheet formulas", () => {
    expect(escapeCsvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(escapeCsvCell("+1")).toBe("\"'+1\"");
    expect(escapeCsvCell("@SUM(A1)")).toBe("\"'@SUM(A1)\"");
    expect(escapeCsvCell("-2")).toBe("\"'-2\"");
  });

  it("writes plain digit amounts and ISO dates", () => {
    const csv = buildCsv([
      base,
      { ...base, id: "t2", type: "transfer", category_id: null, category_name: null, to_account_id: "b", to_account_name: "Bank", note: "isi, saldo" },
    ]);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("id,tanggal,jenis,sumber,nominal_rupiah,dompet,dompet_tujuan,kategori,catatan");
    expect(lines[1]).toBe("11111111-1111-4111-8111-111111111111,2026-10-10,pengeluaran,web,1250000,Tunai,,Makanan,");
    expect(lines[2]).toBe('t2,2026-10-10,transfer,web,1250000,Tunai,Bank,,"isi, saldo"');
  });
});
