import { describe, expect, it } from "vitest";

import { fillDays, summarizeDaily } from "./daily-utils";

describe("fillDays", () => {
  it("returns every day of the period with zeros for missing days", () => {
    const days = fillDays("2026-02-27", "2026-03-02", [{ occurred_on: "2026-02-28", expense_rupiah: "5000" }]);
    expect(days).toEqual([
      { date: "2026-02-27", expense_rupiah: "0" },
      { date: "2026-02-28", expense_rupiah: "5000" },
      { date: "2026-03-01", expense_rupiah: "0" },
    ]);
  });
});

describe("summarizeDaily", () => {
  const days = fillDays("2026-10-01", "2026-11-01", [
    { occurred_on: "2026-10-01", expense_rupiah: "10000" },
    { occurred_on: "2026-10-02", expense_rupiah: "25000" },
    { occurred_on: "2026-10-03", expense_rupiah: "1" },
  ]);

  it("averages over the days up to today, rounded to the nearest rupiah", () => {
    const s = summarizeDaily(days, "2026-10-03");
    expect(s).toMatchObject({ total: "35001", average: "11667", daysCounted: 3, today: "1" });
    expect(s.peak).toEqual({ date: "2026-10-02", expense_rupiah: "25000" });
  });

  it("uses every day for a past month and has no today", () => {
    const s = summarizeDaily(days, "2026-12-15");
    expect(s).toMatchObject({ average: "1129", daysCounted: 31, today: null });
  });

  it("has no average or peak when nothing was spent before the period", () => {
    expect(summarizeDaily(days, "2026-09-30")).toMatchObject({ average: null, daysCounted: 0 });
    expect(summarizeDaily(fillDays("2026-10-01", "2026-10-03", []), "2026-10-02").peak).toBeNull();
  });

  it("keeps precision for very large amounts", () => {
    const big = summarizeDaily([{ date: "2026-10-01", expense_rupiah: "999999999999999" }, { date: "2026-10-02", expense_rupiah: "999999999999999" }], "2026-10-02");
    expect(big.total).toBe("1999999999999998");
    expect(big.average).toBe("999999999999999");
  });
});
