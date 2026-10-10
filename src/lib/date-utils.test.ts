import { describe, expect, it } from "vitest";

import { addDays, isIsoDate, monthRange, relativeDayLabel, shiftMonth, todayJakarta } from "./date-utils";

describe("date-utils", () => {
  it("uses the Jakarta calendar date, not UTC", () => {
    // 2026-10-09 18:30 UTC is already 2026-10-10 01:30 in Jakarta.
    expect(todayJakarta(new Date("2026-10-09T18:30:00Z"))).toBe("2026-10-10");
    expect(todayJakarta(new Date("2026-10-09T16:59:00Z"))).toBe("2026-10-09");
  });

  it("builds month ranges with an exclusive end", () => {
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-03-01" });
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("does date math on calendar dates", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(relativeDayLabel("2026-10-09", "2026-10-10")).toBe("Kemarin");
    expect(relativeDayLabel("2026-10-10", "2026-10-10", "en")).toBe("Today");
    expect(relativeDayLabel("2026-10-09", "2026-10-10", "en")).toBe("Yesterday");
  });
});
