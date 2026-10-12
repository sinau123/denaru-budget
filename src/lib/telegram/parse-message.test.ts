import { describe, expect, it } from "vitest";

import { parseAmountOnly, parseAmountToken, parseMessage, type ParseContext } from "./parse-message";

const ctx: ParseContext = {
  accounts: [
    { id: "acc-cash", name: "Tunai", type: "cash" },
    { id: "acc-bca", name: "BCA", type: "bank" },
    { id: "acc-gopay", name: "GoPay", type: "ewallet" },
  ],
  categories: [
    { id: "cat-food", name: "Makanan", type: "expense", seed_key: "expense_food", parent_name: null },
    { id: "cat-transport", name: "Transportasi", type: "expense", seed_key: "expense_transport", parent_name: null },
    { id: "cat-snack", name: "Jajan", type: "expense", seed_key: null, parent_name: "Makanan" },
    { id: "cat-other", name: "Lainnya", type: "expense", seed_key: "expense_other", parent_name: null },
    { id: "cat-salary", name: "Gaji", type: "income", seed_key: "income_salary", parent_name: null },
    { id: "cat-income-other", name: "Lainnya", type: "income", seed_key: "income_other", parent_name: null },
  ],
  defaultAccountId: "acc-cash",
};

// 2026-10-12 10:00 WIB
const SENT = new Date("2026-10-12T03:00:00Z");

function draftOf(text: string, sentAt = SENT, context = ctx) {
  const result = parseMessage(text, context, sentAt);
  if (result.kind !== "draft") throw new Error(`not a draft: ${text}`);
  return result;
}

describe("parseAmountToken", () => {
  it.each([
    ["20", "rb", 20_000n],
    ["20", "ribu", 20_000n],
    ["50", "k", 50_000n],
    ["5", "jt", 5_000_000n],
    ["12,5", "rb", 12_500n],
    ["1.5", "jt", 1_500_000n],
    ["1,25", "jt", 1_250_000n],
    ["20.000", undefined, 20_000n],
    ["1.250.000", undefined, 1_250_000n],
    ["20000", undefined, 20_000n],
  ])("%s %s → %s", (digits, unit, expected) => {
    expect(parseAmountToken(digits, unit)).toBe(expected);
  });

  it("rejects fractions of a rupiah and zero", () => {
    expect(parseAmountToken("12,5", undefined)).toBeNull();
    expect(parseAmountToken("0", "rb")).toBeNull();
  });
});

describe("parseMessage — PRD examples", () => {
  it("beli nasi 20rb pakai tunai", () => {
    const { draft } = draftOf("beli nasi 20rb pakai tunai");
    expect(draft).toEqual({
      type: "expense",
      amount_rupiah: "20000",
      amount_options: null,
      account_id: "acc-cash",
      category_id: "cat-food",
      occurred_on: "2026-10-12",
      note: "beli nasi",
    });
  });

  it("bensin 50k pakai BCA", () => {
    const { draft } = draftOf("bensin 50k pakai BCA");
    expect(draft).toMatchObject({ type: "expense", amount_rupiah: "50000", account_id: "acc-bca", category_id: "cat-transport", note: "bensin" });
  });

  it("gaji 5jt ke BCA", () => {
    const { draft } = draftOf("gaji 5jt ke BCA");
    expect(draft).toMatchObject({ type: "income", amount_rupiah: "5000000", account_id: "acc-bca", category_id: "cat-salary" });
  });

  it("kopi 18rb kemarin uses the default wallet and the day before the message", () => {
    const { draft } = draftOf("kopi 18rb kemarin");
    expect(draft).toMatchObject({ amount_rupiah: "18000", account_id: "acc-cash", category_id: "cat-food", occurred_on: "2026-10-11", note: "kopi" });
  });
});

describe("parseMessage — dates around midnight (Asia/Jakarta)", () => {
  it("00:30 WIB: kemarin is the previous Jakarta day even though UTC is still yesterday", () => {
    const { draft } = draftOf("kopi 18rb kemarin", new Date("2026-10-12T17:30:00Z"));
    expect(draft.occurred_on).toBe("2026-10-12");
  });

  it("23:59 WIB: today is still the same Jakarta day", () => {
    const { draft } = draftOf("kopi 18rb", new Date("2026-10-12T16:59:00Z"));
    expect(draft.occurred_on).toBe("2026-10-12");
  });
});

describe("parseMessage — ambiguity", () => {
  it("beli 3 burger 3000 offers total or per item", () => {
    const { draft } = draftOf("beli 3 burger 3000");
    expect(draft.amount_rupiah).toBeNull();
    expect(draft.amount_options).toEqual(["3000", "9000"]);
    expect(draft.category_id).toBe("cat-food");
  });

  it("two large amounts leave the amount empty", () => {
    const { draft } = draftOf("makan 20rb 30rb");
    expect(draft.amount_rupiah).toBeNull();
    expect(draft.amount_options).toBeNull();
  });

  it("no amount leaves it empty", () => {
    const { draft } = draftOf("makan siang");
    expect(draft.amount_rupiah).toBeNull();
  });

  it("an unknown wallet is not replaced by the default", () => {
    const result = draftOf("makan 20rb pakai mandiri");
    expect(result.draft.account_id).toBeNull();
    expect(result.walletNotFound).toBe(true);
  });

  it("an unknown category is left for the user to pick", () => {
    expect(draftOf("sumbangan 50rb").draft.category_id).toBeNull();
  });

  it("without a default wallet the wallet stays empty", () => {
    expect(draftOf("kopi 18rb", SENT, { ...ctx, defaultAccountId: null }).draft.account_id).toBeNull();
  });

  it("ignores messages without any transaction content", () => {
    expect(parseMessage("halo", ctx, SENT)).toEqual({ kind: "unrecognized" });
  });
});

describe("parseMessage — matching", () => {
  it("prefers the user's sub-category name over keywords", () => {
    expect(draftOf("jajan 10rb").draft.category_id).toBe("cat-snack");
  });

  it("matches wallet names case-insensitively and type words to the only wallet of that type", () => {
    expect(draftOf("ojek 15rb via gopay").draft.account_id).toBe("acc-gopay");
    expect(draftOf("parkir 5rb pakai cash").draft.account_id).toBe("acc-cash");
  });

  it("income keywords pick an income category", () => {
    expect(draftOf("bonus 1jt ke bca").draft).toMatchObject({ type: "income", category_id: "cat-income-other", account_id: "acc-bca" });
  });

  it("accepts Rp prefixes and grouped thousands", () => {
    expect(draftOf("makan Rp25.000").draft.amount_rupiah).toBe("25000");
    expect(draftOf("makan rp 12,5rb").draft.amount_rupiah).toBe("12500");
  });
});

describe("parseAmountOnly", () => {
  it("accepts a message that is only one amount", () => {
    expect(parseAmountOnly("25rb")).toBe("25000");
    expect(parseAmountOnly(" Rp 9.000 ")).toBe("9000");
    expect(parseAmountOnly("20rb 30rb")).toBeNull();
    expect(parseAmountOnly("berapa ya")).toBeNull();
    // A full sentence is a new transaction, not the requested amount.
    expect(parseAmountOnly("kopi 18rb")).toBeNull();
  });
});
