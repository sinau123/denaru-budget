import { describe, expect, it } from "vitest";

import { formatRupiah, formatRupiahInput, normalizeRupiahInput, sumRupiah, validateRupiah } from "./money-utils";

describe("money-utils", () => {
  it("normalizes typed input", () => {
    expect(normalizeRupiahInput("Rp 25.000")).toBe("25000");
    expect(normalizeRupiahInput("0025000")).toBe("25000");
    expect(normalizeRupiahInput("-1.500")).toBe("-1500");
    expect(normalizeRupiahInput("abc")).toBe("");
  });

  it("validates amounts", () => {
    expect(validateRupiah("25.000")).toEqual({ ok: true, value: "25000" });
    expect(validateRupiah("0")).toEqual({ ok: false, reason: "not_positive" });
    expect(validateRupiah("")).toEqual({ ok: false, reason: "empty" });
    expect(validateRupiah("-5")).toEqual({ ok: false, reason: "not_positive" });
    expect(validateRupiah("-5", { allowNegative: true })).toEqual({ ok: true, value: "-5" });
    expect(validateRupiah("0", { allowZero: true })).toEqual({ ok: true, value: "0" });
    expect(validateRupiah("999999999999999")).toEqual({ ok: true, value: "999999999999999" });
    expect(validateRupiah("1000000000000000")).toEqual({ ok: false, reason: "too_large" });
    expect(validateRupiah("99999999999999999999")).toEqual({ ok: false, reason: "invalid" });
  });

  it("formats rupiah without losing precision", () => {
    expect(formatRupiah("3470000")).toBe("Rp3.470.000");
    expect(formatRupiah("-100")).toBe("-Rp100");
    expect(formatRupiah("1970000", { signed: true })).toBe("+Rp1.970.000");
    expect(formatRupiah("999999999999999")).toBe("Rp999.999.999.999.999");
    expect(formatRupiahInput("25000")).toBe("25.000");
  });

  it("sums with BigInt", () => {
    expect(sumRupiah(["470000", "3000000"])).toBe("3470000");
    expect(sumRupiah(["999999999999999", "999999999999999"])).toBe("1999999999999998");
  });
});
