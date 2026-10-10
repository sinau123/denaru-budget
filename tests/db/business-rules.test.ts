import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, errorOf, type Db } from "./pg-harness";

const USER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_B = "bbbbbbbb-0000-4000-8000-000000000002";

const CASH = "10000000-0000-4000-8000-000000000001";
const BANK = "10000000-0000-4000-8000-000000000002";

function jakartaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const TODAY = jakartaToday();
const MONTH_START = `${TODAY.slice(0, 8)}01`;
const NEXT_MONTH_START = (() => {
  const d = new Date(`${MONTH_START}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
})();

type Account = { id: string; balance_rupiah: string; archived_at: string | null };
type Txn = { id: string; version: number; amount_rupiah: string; replayed?: boolean };
type Category = { id: string; type: string; seed_key: string | null };
type Dashboard = { income_rupiah: string; expense_rupiah: string; net_rupiah: string; daily: unknown[] };

let db: Db;

async function balances(user = USER_A) {
  const rows = await db.as<Account>(user, "select * from api.get_accounts()");
  return Object.fromEntries(rows.map((r) => [r.id, r.balance_rupiah]));
}
async function dashboard(user = USER_A) {
  return db.rpc<Dashboard>(user, "api.get_dashboard($1::date, $2::date)", [MONTH_START, NEXT_MONTH_START]);
}
async function categoryId(user: string, seedKey: string) {
  const rows = await db.as<Category>(user, "select * from api.list_categories() where seed_key = $1", [seedKey]);
  return rows[0].id;
}
function createTxn(user: string, args: {
  id: string; type: string; amount: string; account: string; on?: string;
  to?: string | null; category?: string | null; note?: string;
}) {
  return db.rpc<Txn>(
    user,
    "api.create_transaction($1::uuid, $2, $3, $4::uuid, $5::date, $6::uuid, $7::uuid, $8)",
    [args.id, args.type, args.amount, args.account, args.on ?? MONTH_START, args.to ?? null, args.category ?? null, args.note ?? ""],
  );
}

beforeAll(async () => {
  db = await createDb();
  await db.createUser(USER_A);
  await db.createUser(USER_B);
  await db.rpc(USER_A, "api.bootstrap_user('Pengguna A')");
  await db.rpc(USER_B, "api.bootstrap_user('Pengguna B')");
  await db.rpc(USER_A, "api.create_account($1::uuid, 'Tunai', 'cash', '500000', $2::date)", [CASH, MONTH_START]);
  await db.rpc(USER_A, "api.create_account($1::uuid, 'Bank', 'bank', '1000000', $2::date)", [BANK, MONTH_START]);
});

afterAll(async () => {
  await db?.close();
});

describe("onboarding", () => {
  it("bootstrap is idempotent and seeds categories once", async () => {
    await db.rpc(USER_A, "api.bootstrap_user('Pengguna A')");
    await db.rpc(USER_A, "api.bootstrap_user(null)");
    const cats = await db.as<Category>(USER_A, "select * from api.list_categories()");
    expect(cats).toHaveLength(9);
    expect(cats.filter((c) => c.type === "income").map((c) => c.seed_key).sort()).toEqual(["income_other", "income_salary"]);
  });

  it("retrying wallet creation with the same id does not duplicate", async () => {
    await db.rpc(USER_A, "api.create_account($1::uuid, 'Tunai', 'cash', '500000', $2::date)", [CASH, MONTH_START]);
    const rows = await db.as(USER_A, "select * from api.get_accounts()");
    expect(rows).toHaveLength(2);
    const msg = await errorOf(
      db.rpc(USER_A, "api.create_account($1::uuid, 'Lain', 'cash', '1', $2::date)", [CASH, MONTH_START]),
    );
    expect(msg).toBe("IDEMPOTENCY_CONFLICT");
  });
});

describe("PRD section 04 balance scenario", () => {
  const meal = "30000000-0000-4000-8000-000000000001";
  const transfer = "30000000-0000-4000-8000-000000000002";
  const salary = "30000000-0000-4000-8000-000000000003";

  it("follows the documented table step by step", async () => {
    const food = await categoryId(USER_A, "expense_food");
    const gaji = await categoryId(USER_A, "income_salary");

    expect(await balances()).toEqual({ [CASH]: "500000", [BANK]: "1000000" });

    await createTxn(USER_A, { id: meal, type: "expense", amount: "25000", account: CASH, category: food, note: "Makan" });
    expect(await balances()).toEqual({ [CASH]: "475000", [BANK]: "1000000" });
    expect((await dashboard()).expense_rupiah).toBe("25000");

    await createTxn(USER_A, { id: transfer, type: "transfer", amount: "100000", account: BANK, to: CASH });
    expect(await balances()).toEqual({ [CASH]: "575000", [BANK]: "900000" });
    let d = await dashboard();
    expect([d.income_rupiah, d.expense_rupiah]).toEqual(["0", "25000"]);

    await createTxn(USER_A, { id: salary, type: "income", amount: "2000000", account: BANK, category: gaji });
    expect(await balances()).toEqual({ [CASH]: "575000", [BANK]: "2900000" });
    d = await dashboard();
    expect([d.income_rupiah, d.expense_rupiah]).toEqual(["2000000", "25000"]);

    await db.rpc(USER_A, "api.update_transaction($1::uuid, 1, '30000', $2::uuid, $3::date, null, $4::uuid, 'Makan')", [meal, CASH, MONTH_START, food]);
    expect(await balances()).toEqual({ [CASH]: "570000", [BANK]: "2900000" });
    d = await dashboard();
    expect([d.income_rupiah, d.expense_rupiah]).toEqual(["2000000", "30000"]);

    await db.rpc(USER_A, "api.delete_transaction($1::uuid, 1)", [transfer]);
    const final = await balances();
    expect(final).toEqual({ [CASH]: "470000", [BANK]: "3000000" });
    d = await dashboard();
    expect([d.income_rupiah, d.expense_rupiah, d.net_rupiah]).toEqual(["2000000", "30000", "1970000"]);

    const total = Object.values(final).reduce((sum, v) => sum + BigInt(v), 0n);
    expect(total).toBe(3470000n);
  });

  it("returns one daily bucket per day of the period", async () => {
    const d = await dashboard();
    const days = (Date.parse(NEXT_MONTH_START) - Date.parse(MONTH_START)) / 86400000;
    expect(d.daily).toHaveLength(days);
  });
});

describe("idempotency and concurrency", () => {
  it("replaying the same id and payload returns the stored transaction", async () => {
    const food = await categoryId(USER_A, "expense_food");
    const id = "40000000-0000-4000-8000-000000000001";
    const first = await createTxn(USER_A, { id, type: "expense", amount: "1000", account: CASH, category: food });
    const second = await createTxn(USER_A, { id, type: "expense", amount: "1000", account: CASH, category: food });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    const count = await db.as<{ n: number }>(USER_A, "select count(*)::int as n from app_data.transactions where id = $1", [id]);
    expect(count[0].n).toBe(1);

    const msg = await errorOf(createTxn(USER_A, { id, type: "expense", amount: "2000", account: CASH, category: food }));
    expect(msg).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("rejects edits and deletes with a stale version", async () => {
    const food = await categoryId(USER_A, "expense_food");
    const id = "40000000-0000-4000-8000-000000000002";
    await createTxn(USER_A, { id, type: "expense", amount: "5000", account: CASH, category: food });
    const updated = await db.rpc<Txn>(USER_A, "api.update_transaction($1::uuid, 1, '6000', $2::uuid, $3::date, null, $4::uuid, '')", [id, CASH, MONTH_START, food]);
    expect(updated.version).toBe(2);
    const stale = await errorOf(
      db.rpc(USER_A, "api.update_transaction($1::uuid, 1, '7000', $2::uuid, $3::date, null, $4::uuid, '')", [id, CASH, MONTH_START, food]),
    );
    expect(stale).toBe("VERSION_CONFLICT");
    expect(await errorOf(db.rpc(USER_A, "api.delete_transaction($1::uuid, 1)", [id]))).toBe("VERSION_CONFLICT");
    await db.rpc(USER_A, "api.delete_transaction($1::uuid, 2)", [id]);
  });
});

describe("validation", () => {
  const id = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  it.each([
    ["0", "AMOUNT_INVALID"],
    ["-5", "AMOUNT_INVALID"],
    ["12.5", "AMOUNT_INVALID"],
    ["1e3", "AMOUNT_INVALID"],
    ["9223372036854775807", "AMOUNT_TOO_LARGE"],
    ["99999999999999999999", "AMOUNT_INVALID"],
  ])("rejects amount %s", async (amount, expected) => {
    const food = await categoryId(USER_A, "expense_food");
    expect(await errorOf(createTxn(USER_A, { id: id(1), type: "expense", amount, account: CASH, category: food }))).toBe(expected);
  });

  it("accepts the largest allowed amount without precision loss", async () => {
    const food = await categoryId(USER_A, "expense_food");
    const t = await createTxn(USER_A, { id: id(2), type: "expense", amount: "999999999999999", account: CASH, category: food });
    expect(t.amount_rupiah).toBe("999999999999999");
    await db.rpc(USER_A, "api.delete_transaction($1::uuid, 1)", [id(2)]);
  });

  it("rejects future dates and dates before the wallet opened", async () => {
    const food = await categoryId(USER_A, "expense_food");
    expect(await errorOf(createTxn(USER_A, { id: id(3), type: "expense", amount: "1", account: CASH, category: food, on: addDays(TODAY, 1) }))).toBe("DATE_IN_FUTURE");
    expect(await errorOf(createTxn(USER_A, { id: id(3), type: "expense", amount: "1", account: CASH, category: food, on: addDays(MONTH_START, -1) }))).toBe("DATE_BEFORE_OPENED");
  });

  it("rejects mismatched category types, long notes and invalid transfers", async () => {
    const gaji = await categoryId(USER_A, "income_salary");
    const food = await categoryId(USER_A, "expense_food");
    expect(await errorOf(createTxn(USER_A, { id: id(4), type: "expense", amount: "1", account: CASH, category: gaji }))).toBe("CATEGORY_TYPE_MISMATCH");
    expect(await errorOf(createTxn(USER_A, { id: id(4), type: "expense", amount: "1", account: CASH, category: food, note: "x".repeat(251) }))).toBe("NOTE_TOO_LONG");
    expect(await errorOf(createTxn(USER_A, { id: id(4), type: "transfer", amount: "1", account: CASH, to: CASH }))).toBe("SAME_ACCOUNT");
    expect(await errorOf(createTxn(USER_A, { id: id(4), type: "transfer", amount: "1", account: CASH, to: BANK, category: food }))).toBe("TRANSFER_HAS_CATEGORY");
  });

  it.skipIf(TODAY === MONTH_START)("does not let the opening date move past existing transactions", async () => {
    const msg = await errorOf(
      db.rpc(USER_A, "api.update_account($1::uuid, 'Tunai', 'cash', '500000', $2::date)", [CASH, addDays(MONTH_START, 1)]),
    );
    expect(msg).toBe("OPENED_ON_AFTER_TRANSACTIONS");
  });

  it("rejects an opening date in the future", async () => {
    const msg = await errorOf(
      db.rpc(USER_A, "api.update_account($1::uuid, 'Tunai', 'cash', '500000', $2::date)", [CASH, addDays(TODAY, 1)]),
    );
    expect(msg).toBe("DATE_IN_FUTURE");
  });

  it("blocks deleting a wallet that has transactions", async () => {
    expect(await errorOf(db.rpc(USER_A, "api.delete_account($1::uuid)", [CASH]))).toBe("ACCOUNT_HAS_TRANSACTIONS");
  });
});

describe("archived references", () => {
  const ARCHIVED = "10000000-0000-4000-8000-000000000003";
  const txnId = "60000000-0000-4000-8000-000000000001";

  it("keeps existing references on edit but refuses new ones", async () => {
    const food = await categoryId(USER_A, "expense_food");
    await db.rpc(USER_A, "api.create_account($1::uuid, 'Lama', 'ewallet', '0', $2::date)", [ARCHIVED, MONTH_START]);
    await createTxn(USER_A, { id: txnId, type: "expense", amount: "100", account: ARCHIVED, category: food });
    await db.rpc(USER_A, "api.set_account_archived($1::uuid, true)", [ARCHIVED]);

    // Still counted in balances.
    expect(await balances()).toHaveProperty(ARCHIVED, "-100");
    // Editing the note while keeping the archived wallet is allowed.
    const t = await db.rpc<Txn>(USER_A, "api.update_transaction($1::uuid, 1, '100', $2::uuid, $3::date, null, $4::uuid, 'catatan')", [txnId, ARCHIVED, MONTH_START, food]);
    expect(t.version).toBe(2);
    // Choosing the archived wallet for a new transaction is not.
    expect(await errorOf(createTxn(USER_A, { id: "60000000-0000-4000-8000-000000000002", type: "expense", amount: "1", account: ARCHIVED, category: food }))).toBe("ARCHIVED_REFERENCE");
    // Moving another transaction onto it is not either.
    const other = "60000000-0000-4000-8000-000000000003";
    await createTxn(USER_A, { id: other, type: "expense", amount: "1", account: CASH, category: food });
    expect(await errorOf(db.rpc(USER_A, "api.update_transaction($1::uuid, 1, '1', $2::uuid, $3::date, null, $4::uuid, '')", [other, ARCHIVED, MONTH_START, food]))).toBe("ARCHIVED_REFERENCE");
  });
});

describe("account isolation (RLS)", () => {
  it("user B cannot see or touch user A data", async () => {
    expect(await db.as(USER_B, "select * from api.get_accounts()")).toEqual([]);
    expect(await db.as(USER_B, "select * from api.list_transactions()")).toEqual([]);
    expect(await db.as(USER_B, "select * from app_data.transactions")).toEqual([]);
    expect(await db.rpc(USER_B, "api.get_transaction('30000000-0000-4000-8000-000000000001'::uuid)")).toBeNull();
    expect(await errorOf(db.rpc(USER_B, "api.delete_transaction('30000000-0000-4000-8000-000000000001'::uuid, 2)"))).toBe("NOT_FOUND");
    expect(await errorOf(db.rpc(USER_B, "api.set_account_archived($1::uuid, true)", [CASH]))).toBe("NOT_FOUND");
  });

  it("user B cannot reference user A wallets or categories", async () => {
    const food = await categoryId(USER_A, "expense_food");
    const ownFood = await categoryId(USER_B, "expense_food");
    const B_WALLET = "10000000-0000-4000-8000-0000000000b1";
    await db.rpc(USER_B, "api.create_account($1::uuid, 'Dompet B', 'cash', '0', $2::date)", [B_WALLET, MONTH_START]);

    expect(await errorOf(createTxn(USER_B, { id: "70000000-0000-4000-8000-000000000001", type: "expense", amount: "1", account: CASH, category: ownFood }))).toBe("ACCOUNT_NOT_FOUND");
    expect(await errorOf(createTxn(USER_B, { id: "70000000-0000-4000-8000-000000000001", type: "expense", amount: "1", account: B_WALLET, category: food }))).toBe("CATEGORY_NOT_FOUND");
    expect(await errorOf(createTxn(USER_B, { id: "70000000-0000-4000-8000-000000000001", type: "transfer", amount: "1", account: B_WALLET, to: CASH }))).toBe("ACCOUNT_NOT_FOUND");
  });

  it("reusing another user's transaction id is a conflict, not a leak", async () => {
    const ownFood = await categoryId(USER_B, "expense_food");
    const msg = await errorOf(createTxn(USER_B, { id: "30000000-0000-4000-8000-000000000001", type: "expense", amount: "1", account: "10000000-0000-4000-8000-0000000000b1", category: ownFood }));
    expect(msg).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("cannot forge user_id through direct table writes", async () => {
    const msg = await errorOf(db.as(USER_B, "insert into app_data.accounts (id, user_id, name, type, opened_on) values (gen_random_uuid(), $1, 'x', 'cash', $2)", [USER_A, MONTH_START]));
    expect(msg).toMatch(/row-level security/);
    const upd = await errorOf(db.as(USER_A, "update app_data.transactions set user_id = $1", [USER_B]));
    expect(upd).toMatch(/permission denied/);
  });

  it("anonymous callers cannot execute any RPC", async () => {
    expect(await errorOf(db.as(null, "select * from api.get_accounts()"))).toMatch(/permission denied/);
    expect(await errorOf(db.as(null, "select api.bootstrap_user(null)"))).toMatch(/permission denied/);
    expect(await errorOf(db.as(null, "select * from app_data.transactions"))).toMatch(/permission denied/);
  });
});

describe("history and export", () => {
  it("paginates with a stable cursor and filters transfers by wallet", async () => {
    const food = await categoryId(USER_A, "expense_food");
    for (let i = 0; i < 60; i++) {
      await createTxn(USER_A, { id: `80000000-0000-4000-8000-${String(i).padStart(12, "0")}`, type: "expense", amount: "10", account: CASH, category: food, note: `bulk ${i}` });
    }
    await createTxn(USER_A, { id: "80000000-0000-4000-8000-999999999999", type: "transfer", amount: "10", account: BANK, to: CASH });

    type Row = { id: string; occurred_on: string; created_at: string; type: string };
    const seen = new Set<string>();
    let cursor: Row | null = null;
    let pages = 0;
    for (;;) {
      const rows: Row[] = await db.as<Row>(
        USER_A,
        "select * from api.list_transactions(p_cursor_occurred_on => $1::date, p_cursor_created_at => $2::timestamptz, p_cursor_id => $3::uuid, p_limit => 50)",
        [cursor?.occurred_on ?? null, cursor?.created_at ?? null, cursor?.id ?? null],
      );
      pages++;
      rows.forEach((r) => seen.add(r.id));
      if (rows.length < 50) break;
      cursor = rows[rows.length - 1];
    }
    const total = await db.as<{ n: number }>(USER_A, "select count(*)::int as n from app_data.transactions");
    expect(seen.size).toBe(total[0].n);
    expect(pages).toBeGreaterThan(1);

    const cashRows = await db.as<Row>(USER_A, "select * from api.list_transactions(p_account_id => $1::uuid)", [CASH]);
    expect(cashRows.some((r) => r.type === "transfer")).toBe(true);
    const catRows = await db.as<Row>(USER_A, "select * from api.list_transactions(p_category_id => $1::uuid)", [food]);
    expect(catRows.every((r) => r.type !== "transfer")).toBe(true);
    const search = await db.as<Row>(USER_A, "select * from api.list_transactions(p_search => 'BULK 5')");
    expect(search.length).toBe(11); // bulk 5, bulk 50..59
  });

  it("bumps data_version on every business mutation", async () => {
    const before = await db.rpc<{ data_version: string }>(USER_A, "api.get_profile()");
    const cat = await db.rpc<{ id: string }>(USER_A, "api.create_category(gen_random_uuid(), 'Hewan', 'expense')");
    await db.rpc(USER_A, "api.rename_category($1::uuid, 'Peliharaan')", [cat.id]);
    const after = await db.rpc<{ data_version: string }>(USER_A, "api.get_profile()");
    expect(BigInt(after.data_version) - BigInt(before.data_version)).toBe(2n);
  });
});
