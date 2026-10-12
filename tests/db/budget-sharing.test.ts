import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, errorOf, type Db } from "./pg-harness";

const OWNER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const MEMBER = "bbbbbbbb-0000-4000-8000-0000000000b2";
const OTHER = "cccccccc-0000-4000-8000-0000000000c3";
const OWNER_EMAIL = "owner@example.com";
const MEMBER_EMAIL = "member@example.com";
const OTHER_EMAIL = "other@example.com";

const OWNER_CASH = "10000000-0000-4000-8000-0000000000a1";
const MEMBER_CASH = "10000000-0000-4000-8000-0000000000b2";
const INVITE = "50000000-0000-4000-8000-000000000001";
const OTHER_INVITE = "50000000-0000-4000-8000-000000000002";

function jakartaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}
const TODAY = jakartaToday();
const MONTH_START = `${TODAY.slice(0, 8)}01`;
const NEXT_MONTH_START = (() => {
  const d = new Date(`${MONTH_START}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
})();

type Profile = { id: string; data_version: string; has_accounts: boolean; budget: { owner_id: string; owner_name: string; is_own: boolean } };
type Sharing = {
  members: { id: string; email: string; status: string }[];
  shared_with_me: { id: string; owner_id: string; owner_name: string; status: string }[];
};
type Txn = { id: string; version: number; amount_rupiah: string };

let db: Db;

async function expenseCategory(user: string) {
  const rows = await db.as<{ id: string }>(user, "select id from api.list_categories() where seed_key = 'expense_food'");
  return rows[0].id;
}
function createExpense(user: string, id: string, account: string, category: string, amount = "10000") {
  return db.rpc<Txn>(
    user,
    "api.create_transaction($1::uuid, 'expense', $2, $3::uuid, $4::date, null, $5::uuid, '')",
    [id, amount, account, MONTH_START, category],
  );
}
const profile = (user: string) => db.rpc<Profile>(user, "api.get_profile()");
const sharing = (user: string) => db.rpc<Sharing>(user, "api.get_budget_sharing()");
const useBudget = (user: string, owner: string | null) => db.rpc<Profile>(user, "api.set_active_budget($1::uuid)", [owner]);
const accountIds = async (user: string) =>
  (await db.as<{ id: string }>(user, "select id from api.get_accounts()")).map((r) => r.id);

beforeAll(async () => {
  db = await createDb();
  await db.createUser(OWNER, OWNER_EMAIL);
  await db.createUser(MEMBER, MEMBER_EMAIL);
  await db.createUser(OTHER, OTHER_EMAIL);
  await db.rpc(OWNER, "api.bootstrap_user('Pemilik')");
  await db.rpc(MEMBER, "api.bootstrap_user('Anggota')");
  await db.rpc(OTHER, "api.bootstrap_user('Lain')");
  await db.rpc(OWNER, "api.create_account($1::uuid, 'Tunai Pemilik', 'cash', '500000', $2::date)", [OWNER_CASH, MONTH_START]);
  await db.rpc(MEMBER, "api.create_account($1::uuid, 'Tunai Anggota', 'cash', '100000', $2::date)", [MEMBER_CASH, MONTH_START]);
});

afterAll(async () => {
  await db?.close();
});

describe("invitations", () => {
  it("rejects invalid, self and duplicate invites", async () => {
    expect(await errorOf(db.rpc(OWNER, "api.invite_budget_member($1::uuid, 'bukan-email')", [INVITE]))).toBe("EMAIL_INVALID");
    expect(await errorOf(db.rpc(OWNER, "api.invite_budget_member($1::uuid, $2)", [INVITE, "OWNER@example.com"]))).toBe("INVITE_SELF");

    await db.rpc(OWNER, "api.invite_budget_member($1::uuid, $2)", [INVITE, " Member@Example.com "]);
    // Same request replayed is fine; the same email under a new id is not.
    const replay = await db.rpc<{ email: string }>(OWNER, "api.invite_budget_member($1::uuid, $2)", [INVITE, MEMBER_EMAIL]);
    expect(replay.email).toBe(MEMBER_EMAIL);
    expect(
      await errorOf(db.rpc(OWNER, "api.invite_budget_member($1::uuid, $2)", ["50000000-0000-4000-8000-0000000000ff", MEMBER_EMAIL])),
    ).toBe("INVITE_EXISTS");
  });

  it("is visible only to the owner and the invited email", async () => {
    expect((await sharing(OWNER)).members.map((m) => [m.email, m.status])).toEqual([[MEMBER_EMAIL, "pending"]]);
    const incoming = (await sharing(MEMBER)).shared_with_me;
    expect(incoming).toHaveLength(1);
    expect(incoming[0]).toMatchObject({ owner_id: OWNER, owner_name: "Pemilik", status: "pending" });
    expect(await sharing(OTHER)).toEqual({ members: [], shared_with_me: [] });
    expect(await db.as(OTHER, "select * from app_data.budget_members")).toEqual([]);
  });

  it("gives no access before the invite is accepted", async () => {
    expect(await errorOf(useBudget(MEMBER, OWNER))).toBe("NOT_FOUND");
    expect(await db.as(MEMBER, "select * from app_data.accounts where user_id = $1", [OWNER])).toEqual([]);
  });

  it("can only be accepted by the invited user", async () => {
    expect(await errorOf(db.rpc(OTHER, "api.respond_budget_invite($1::uuid, true)", [INVITE]))).toBe("NOT_FOUND");
    expect(await errorOf(db.rpc(OWNER, "api.respond_budget_invite($1::uuid, true)", [INVITE]))).toBe("NOT_FOUND");
    await db.rpc(MEMBER, "api.respond_budget_invite($1::uuid, true)", [INVITE]);
    // A repeated accept after a lost response is harmless.
    const again = await db.rpc<Sharing>(MEMBER, "api.respond_budget_invite($1::uuid, true)", [INVITE]);
    expect(again.shared_with_me[0].status).toBe("accepted");
    expect((await sharing(OWNER)).members[0].status).toBe("accepted");
  });

  it("accepting does not switch the member's budget", async () => {
    expect((await profile(MEMBER)).budget).toEqual({ owner_id: MEMBER, owner_name: "Anggota", is_own: true });
    expect(await accountIds(MEMBER)).toEqual([MEMBER_CASH]);
  });

  it("a declined invite disappears", async () => {
    await db.rpc(OWNER, "api.invite_budget_member($1::uuid, $2)", [OTHER_INVITE, OTHER_EMAIL]);
    await db.rpc(OTHER, "api.respond_budget_invite($1::uuid, false)", [OTHER_INVITE]);
    expect((await sharing(OWNER)).members.map((m) => m.email)).toEqual([MEMBER_EMAIL]);
  });
});

describe("member using the owner's budget", () => {
  const memberTxn = "60000000-0000-4000-8000-000000000001";
  const ownerTxn = "60000000-0000-4000-8000-000000000002";

  it("switches to the owner's budget", async () => {
    const p = await useBudget(MEMBER, OWNER);
    expect(p.budget).toEqual({ owner_id: OWNER, owner_name: "Pemilik", is_own: false });
    expect(p.id).toBe(MEMBER);
    // Onboarding status stays about the member's own wallets.
    expect(p.has_accounts).toBe(true);
    expect(p.data_version).toBe((await profile(OWNER)).data_version);
  });

  it("sees the same wallets, categories and history as the owner", async () => {
    expect(await accountIds(MEMBER)).toEqual([OWNER_CASH]);
    const ownerCats = await db.as(OWNER, "select id from api.list_categories()");
    expect(await db.as(MEMBER, "select id from api.list_categories()")).toEqual(ownerCats);
  });

  it("creates, edits and deletes transactions in the owner's budget", async () => {
    const food = await expenseCategory(OWNER);
    const created = await createExpense(MEMBER, memberTxn, OWNER_CASH, food, "25000");
    expect(created.amount_rupiah).toBe("25000");

    // Owner sees it, and the dashboard is identical for both.
    const ownerRows = await db.as<{ id: string }>(OWNER, "select id from api.list_transactions()");
    expect(ownerRows.map((r) => r.id)).toContain(memberTxn);
    const dash = (user: string) => db.rpc(user, "api.get_dashboard($1::date, $2::date)", [MONTH_START, NEXT_MONTH_START]);
    expect(await dash(MEMBER)).toEqual(await dash(OWNER));
    expect(await db.as(MEMBER, "select * from api.get_accounts()")).toEqual(await db.as(OWNER, "select * from api.get_accounts()"));

    // Member edits a transaction created by the owner, and deletes their own.
    await createExpense(OWNER, ownerTxn, OWNER_CASH, food, "5000");
    const edited = await db.rpc<Txn>(
      MEMBER,
      "api.update_transaction($1::uuid, 1, '7000', $2::uuid, $3::date, null, $4::uuid, 'ubah')",
      [ownerTxn, OWNER_CASH, MONTH_START, food],
    );
    expect([edited.amount_rupiah, edited.version]).toEqual(["7000", 2]);
    await db.rpc(MEMBER, "api.delete_transaction($1::uuid, 1)", [memberTxn]);
    expect(await db.rpc(OWNER, "api.get_transaction($1::uuid)", [memberTxn])).toBeNull();
  });

  it("records who created each transaction and keeps it on edit", async () => {
    const food = await expenseCategory(OWNER);
    const id = "60000000-0000-4000-8000-000000000010";
    const created = await createExpense(MEMBER, id, OWNER_CASH, food, "12000");
    expect(created).toMatchObject({ created_by: MEMBER, updated_by: null });
    // The owner edits it; the recorder stays the member, the editor is the owner.
    const edited = await db.rpc(OWNER, "api.update_transaction($1::uuid, 1, '13000', $2::uuid, $3::date, null, $4::uuid, '')", [id, OWNER_CASH, MONTH_START, food]);
    expect(edited).toMatchObject({ created_by: MEMBER, updated_by: OWNER });

    type Row = {
      id: string;
      created_by: string | null;
      created_by_name: string | null;
      updated_by: string | null;
      updated_by_name: string | null;
    };
    const recorder = async (user: string, txn: string) =>
      (await db.as<Row>(user, "select * from api.list_transactions()")).find((r) => r.id === txn);
    expect(await recorder(OWNER, id)).toMatchObject({
      created_by: MEMBER,
      created_by_name: "Anggota",
      updated_by: OWNER,
      updated_by_name: "Pemilik",
    });
    expect(await recorder(MEMBER, id)).toMatchObject({ created_by: MEMBER, created_by_name: "Anggota" });
    expect(await recorder(MEMBER, "60000000-0000-4000-8000-000000000002")).toMatchObject({
      created_by: OWNER,
      created_by_name: "Pemilik",
    });
    const exported = await db.as<Row>(OWNER, "select * from api.export_transactions()");
    expect(exported.find((r) => r.id === id)).toMatchObject({ created_by_name: "Anggota", updated_by_name: "Pemilik" });

    // The member edits it back; the last editor follows.
    await db.rpc(MEMBER, "api.update_transaction($1::uuid, 2, '12000', $2::uuid, $3::date, null, $4::uuid, '')", [id, OWNER_CASH, MONTH_START, food]);
    expect(await recorder(OWNER, id)).toMatchObject({ created_by: MEMBER, updated_by: MEMBER, updated_by_name: "Anggota" });
  });

  it("the recorder cannot be spoofed", async () => {
    const food = await expenseCategory(OWNER);
    const id = "60000000-0000-4000-8000-000000000011";
    await db.as(
      MEMBER,
      `insert into app_data.transactions (id, user_id, type, amount_rupiah, account_id, category_id, occurred_on, created_by)
       values ($1, $2, 'expense', 1000, $3, $4, $5, $2)`,
      [id, OWNER, OWNER_CASH, food, MONTH_START],
    );
    const [row] = await db.as<{ created_by: string }>(OWNER, "select created_by from app_data.transactions where id = $1", [id]);
    expect(row.created_by).toBe(MEMBER);
    expect(await errorOf(db.as(MEMBER, "update app_data.transactions set created_by = $2 where id = $1", [id, OWNER]))).toMatch(
      /permission denied/,
    );
    expect(await errorOf(db.as(MEMBER, "update app_data.transactions set updated_by = $2 where id = $1", [id, OWNER]))).toMatch(
      /permission denied/,
    );
    // An edit made directly on the table is still attributed to the caller.
    await db.as(MEMBER, "update app_data.transactions set note = 'x' where id = $1", [id]);
    const [after] = await db.as<{ updated_by: string }>(OWNER, "select updated_by from app_data.transactions where id = $1", [id]);
    expect(after.updated_by).toBe(MEMBER);
  });

  it("cannot change the owner's wallets or categories", async () => {
    const food = await expenseCategory(OWNER);
    expect(
      await errorOf(db.rpc(MEMBER, "api.update_account($1::uuid, 'X', 'cash', '0', $2::date)", [OWNER_CASH, MONTH_START])),
    ).toBe("NOT_FOUND");
    expect(await errorOf(db.rpc(MEMBER, "api.set_account_archived($1::uuid, true)", [OWNER_CASH]))).toBe("NOT_FOUND");
    expect(await errorOf(db.rpc(MEMBER, "api.delete_account($1::uuid)", [OWNER_CASH]))).toBe("NOT_FOUND");
    expect(await errorOf(db.rpc(MEMBER, "api.update_category($1::uuid, 'X', null)", [food]))).toBe("NOT_FOUND");
    expect(await errorOf(db.rpc(MEMBER, "api.set_category_archived($1::uuid, true)", [food]))).toBe("NOT_FOUND");
    // Even bypassing the RPCs, RLS blocks writes to the owner's rows.
    await db.as(MEMBER, "update app_data.accounts set name = 'X' where id = $1", [OWNER_CASH]);
    const [row] = await db.as<{ name: string }>(OWNER, "select name from api.get_accounts()");
    expect(row.name).toBe("Tunai Pemilik");
  });

  it("cannot use its own wallets inside the owner's budget", async () => {
    const food = await expenseCategory(OWNER);
    expect(await errorOf(createExpense(MEMBER, "60000000-0000-4000-8000-000000000003", MEMBER_CASH, food))).toBe(
      "ACCOUNT_NOT_FOUND",
    );
  });

  it("other users still see nothing of the owner's budget", async () => {
    expect(await errorOf(useBudget(OTHER, OWNER))).toBe("NOT_FOUND");
    expect(await db.as(OTHER, "select * from app_data.transactions where user_id = $1", [OWNER])).toEqual([]);
    expect(await db.as(OTHER, "select * from app_data.profiles where id = $1", [OWNER])).toEqual([]);
  });

  it("the owner cannot read the member's own budget", async () => {
    expect(await db.as(OWNER, "select * from app_data.accounts where user_id = $1", [MEMBER])).toEqual([]);
    expect(await errorOf(useBudget(OWNER, MEMBER))).toBe("NOT_FOUND");
  });

  it("switching back shows the member's own budget", async () => {
    const p = await useBudget(MEMBER, null);
    expect(p.budget.is_own).toBe(true);
    expect(await accountIds(MEMBER)).toEqual([MEMBER_CASH]);
  });
});

describe("removing access", () => {
  it("revoking falls back to the member's own budget and clears the choice", async () => {
    await useBudget(MEMBER, OWNER);
    await db.rpc(OWNER, "api.remove_budget_member($1::uuid)", [INVITE]);
    expect((await profile(MEMBER)).budget.is_own).toBe(true);
    expect(await accountIds(MEMBER)).toEqual([MEMBER_CASH]);
    expect(await db.as(MEMBER, "select * from app_data.transactions where user_id = $1", [OWNER])).toEqual([]);
    const [p] = await db.as<{ active_budget_id: string | null }>(MEMBER, "select active_budget_id from app_data.profiles where id = $1", [MEMBER]);
    expect(p.active_budget_id).toBeNull();
  });

  it("former members still appear as the recorder of their transactions", async () => {
    const [row] = await db.as<{ created_by_name: string }>(
      OWNER,
      "select created_by_name from api.list_transactions() where id = '60000000-0000-4000-8000-000000000010'",
    );
    expect(row.created_by_name).toBe("Anggota");
  });

  it("a member can leave; outsiders cannot remove anyone", async () => {
    const id = "50000000-0000-4000-8000-000000000003";
    await db.rpc(OWNER, "api.invite_budget_member($1::uuid, $2)", [id, MEMBER_EMAIL]);
    await db.rpc(MEMBER, "api.respond_budget_invite($1::uuid, true)", [id]);
    expect(await errorOf(db.rpc(OTHER, "api.remove_budget_member($1::uuid)", [id]))).toBe("NOT_FOUND");
    const after = await db.rpc<Sharing>(MEMBER, "api.remove_budget_member($1::uuid)", [id]);
    expect(after.shared_with_me).toEqual([]);
    expect((await sharing(OWNER)).members).toEqual([]);
  });

  it("limits a budget to four invited people", async () => {
    for (let i = 0; i < 4; i++) {
      await db.rpc(OWNER, "api.invite_budget_member($1::uuid, $2)", [`5100000${i}-0000-4000-8000-000000000000`, `p${i}@example.com`]);
    }
    expect(
      await errorOf(db.rpc(OWNER, "api.invite_budget_member($1::uuid, $2)", ["51000009-0000-4000-8000-000000000000", "p9@example.com"])),
    ).toBe("MEMBER_LIMIT");
  });
});

describe("deleted accounts", () => {
  it("clears the recorder and editor instead of blocking the deletion", async () => {
    const food = await expenseCategory(OWNER);
    const id = "60000000-0000-4000-8000-000000000020";
    // Free a slot left full by the member-limit test.
    await db.rpc(OWNER, "api.remove_budget_member($1::uuid)", ["51000000-0000-4000-8000-000000000000"]);
    await db.rpc(OWNER, "api.invite_budget_member($1::uuid, $2)", ["50000000-0000-4000-8000-000000000020", OTHER_EMAIL]);
    const [invite] = (await sharing(OTHER)).shared_with_me;
    await db.rpc(OTHER, "api.respond_budget_invite($1::uuid, true)", [invite.id]);
    await useBudget(OTHER, OWNER);
    await createExpense(OTHER, id, OWNER_CASH, food);
    await db.rpc(OTHER, "api.update_transaction($1::uuid, 1, '2000', $2::uuid, $3::date, null, $4::uuid, '')", [id, OWNER_CASH, MONTH_START, food]);

    await db.pg.query("delete from auth.users where id = $1", [OTHER]);
    const [row] = await db.as<{ created_by: string | null; updated_by: string | null }>(
      OWNER,
      "select created_by, updated_by from api.list_transactions() where id = $1",
      [id],
    );
    expect(row).toEqual({ created_by: null, updated_by: null });
  });
});
