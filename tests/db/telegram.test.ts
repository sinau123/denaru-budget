import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, errorOf, type Db } from "./pg-harness";

const OWNER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const MEMBER = "bbbbbbbb-0000-4000-8000-0000000000b2";
const OTHER = "cccccccc-0000-4000-8000-0000000000c3";

const OWNER_CASH = "10000000-0000-4000-8000-0000000000a1";
const OWNER_BANK = "10000000-0000-4000-8000-0000000000a2";
const MEMBER_CASH = "10000000-0000-4000-8000-0000000000b2";
const INVITE = "50000000-0000-4000-8000-000000000001";

const BOT = "7000000001";
const TG_OWNER = { user: "111111", chat: "111111" };
const TG_MEMBER = { user: "222222", chat: "222222" };
const TG_STRANGER = { user: "333333", chat: "333333" };

function jakartaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}
const TODAY = jakartaToday();
const MONTH_START = `${TODAY.slice(0, 8)}01`;
const TOMORROW = (() => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();

type Status = {
  link: { username: string; default_account_id: string | null } | null;
  pending: { id: string; claimed: boolean; username: string } | null;
};
type Draft = {
  id: string;
  version: number;
  status: string;
  ready: boolean;
  amount_rupiah: string | null;
  account_id: string | null;
  account_name: string | null;
  category_id: string | null;
  category_name: string | null;
  transaction_id: string;
};
type Commit = { draft: Draft; transaction: { id: string; source: string; created_by: string; amount_rupiah: string } | null; replayed: boolean };
type Context = {
  linked: boolean;
  budget?: { owner_id: string; is_own: boolean };
  budgets?: { owner_id: string; is_own: boolean }[];
  default_account_id?: string | null;
  accounts?: { id: string; name: string }[];
  categories?: { id: string; seed_key: string | null; type: string }[];
  active_draft?: Draft | null;
};

let db: Db;
let updateSeq = 1000;
let messageSeq = 1;
const nextUpdate = () => String(++updateSeq);
const nextMessage = () => String(++messageSeq);

const status = (user: string) => db.rpc<Status>(user, "api.telegram_get_status()");

async function pair(user: string, tg: { user: string; chat: string }, username: string) {
  const token = await db.rpc<{ id: string; code: string }>(user, "api.telegram_create_link_token()");
  await db.service("api.tg_claim_link_token($1, $2, $3, $4, $5, $6)", [BOT, token.code, tg.user, tg.chat, username, username]);
  return db.rpc<Status>(user, "api.telegram_confirm_link($1::uuid)", [token.id]);
}

const context = (tg: { user: string; chat: string }) =>
  db.service<Context>("api.tg_get_context($1, $2, $3)", [BOT, tg.user, tg.chat]);

async function foodCategory(tg: { user: string; chat: string }) {
  const ctx = await context(tg);
  return ctx.categories!.find((c) => c.seed_key === "expense_food")!.id;
}

function createDraft(
  tg: { user: string; chat: string },
  draft: Record<string, unknown>,
  update = nextUpdate(),
  message = nextMessage(),
) {
  return db.service<Draft>("api.tg_create_draft($1, $2, $3, $4, $5, $6::jsonb)", [
    BOT,
    update,
    tg.user,
    tg.chat,
    message,
    JSON.stringify({ type: "expense", occurred_on: TODAY, note: "", ...draft }),
  ]);
}

const updateDraft = (tg: { user: string; chat: string }, draft: Draft, changes: Record<string, unknown>, update = nextUpdate()) =>
  db.service<Draft>("api.tg_update_draft($1, $2, $3, $4, $5::uuid, $6::int, $7::jsonb)", [
    BOT,
    update,
    tg.user,
    tg.chat,
    draft.id,
    draft.version,
    JSON.stringify(changes),
  ]);

const commit = (tg: { user: string; chat: string }, draftId: string, version: number, update = nextUpdate()) =>
  db.service<Commit>("api.tg_commit_draft($1, $2, $3, $4, $5::uuid, $6::int)", [BOT, update, tg.user, tg.chat, draftId, version]);

const transactionCount = async (owner: string, id: string) =>
  (await db.pg.query<{ n: number }>("select count(*)::int as n from app_data.transactions where user_id = $1 and id = $2", [owner, id]))
    .rows[0].n;

beforeAll(async () => {
  db = await createDb();
  await db.createUser(OWNER, "owner@example.com");
  await db.createUser(MEMBER, "member@example.com");
  await db.createUser(OTHER, "other@example.com");
  await db.rpc(OWNER, "api.bootstrap_user('Pemilik')");
  await db.rpc(MEMBER, "api.bootstrap_user('Anggota')");
  await db.rpc(OTHER, "api.bootstrap_user('Lain')");
  await db.rpc(OWNER, "api.create_account($1::uuid, 'Tunai', 'cash', '500000', $2::date)", [OWNER_CASH, MONTH_START]);
  await db.rpc(OWNER, "api.create_account($1::uuid, 'BCA', 'bank', '1000000', $2::date)", [OWNER_BANK, MONTH_START]);
  await db.rpc(MEMBER, "api.create_account($1::uuid, 'Dompet Anggota', 'cash', '100000', $2::date)", [MEMBER_CASH, MONTH_START]);
});

afterAll(async () => {
  await db?.close();
});

describe("access", () => {
  it("keeps bot functions away from signed-in users and anonymous callers", async () => {
    for (const user of [OWNER, null]) {
      const message = await errorOf(db.rpc(user, "api.tg_get_context($1, $2, $3)", [BOT, TG_OWNER.user, TG_OWNER.chat]));
      expect(message).toMatch(/permission denied/);
    }
    expect(await errorOf(db.rpc(null, "api.telegram_get_status()"))).toMatch(/permission denied/);
  });

  it("does not expose integration tables", async () => {
    expect(await errorOf(db.as(OWNER, "select * from app_data.telegram_links"))).toMatch(/permission denied/);
  });

  it("treats unknown identities as not linked", async () => {
    expect(await context(TG_STRANGER)).toEqual({ linked: false });
    expect(await errorOf(createDraft(TG_STRANGER, { amount_rupiah: "1000" }))).toBe("TELEGRAM_NOT_LINKED");
  });
});

describe("pairing", () => {
  it("needs a valid, unexpired, unclaimed code and web approval", async () => {
    expect(
      await errorOf(db.service("api.tg_claim_link_token($1, $2, $3, $4, '', '')", [BOT, "0".repeat(32), TG_OWNER.user, TG_OWNER.chat])),
    ).toBe("TOKEN_INVALID");

    const token = await db.rpc<{ id: string; code: string }>(OWNER, "api.telegram_create_link_token()");
    expect(token.code).toMatch(/^[0-9a-f]{32}$/);
    // Not claimed yet: nothing to approve.
    expect(await errorOf(db.rpc(OWNER, "api.telegram_confirm_link($1::uuid)", [token.id]))).toBe("TOKEN_NOT_CLAIMED");

    await db.service("api.tg_claim_link_token($1, $2, $3, $4, 'pemilik', 'Pemilik')", [BOT, token.code, TG_OWNER.user, TG_OWNER.chat]);
    // A second identity cannot take over a claimed code.
    expect(
      await errorOf(db.service("api.tg_claim_link_token($1, $2, $3, $4, '', '')", [BOT, token.code, TG_STRANGER.user, TG_STRANGER.chat])),
    ).toBe("TOKEN_INVALID");

    const pending = await status(OWNER);
    expect(pending.pending).toMatchObject({ id: token.id, claimed: true, username: "pemilik" });
    // Only the user who created the code can approve it.
    expect(await errorOf(db.rpc(OTHER, "api.telegram_confirm_link($1::uuid)", [token.id]))).toBe("TOKEN_INVALID");

    const linked = await db.rpc<Status>(OWNER, "api.telegram_confirm_link($1::uuid)", [token.id]);
    expect(linked.link).toMatchObject({ username: "pemilik", default_account_id: null });
    expect(linked.pending).toBeNull();

    // The code cannot be used again.
    expect(
      await errorOf(db.service("api.tg_claim_link_token($1, $2, $3, $4, '', '')", [BOT, token.code, TG_OWNER.user, TG_OWNER.chat])),
    ).toBe("TOKEN_INVALID");
    expect((await context(TG_OWNER)).linked).toBe(true);
  });

  it("rejects expired codes", async () => {
    const token = await db.rpc<{ id: string; code: string }>(OTHER, "api.telegram_create_link_token()");
    await db.pg.query("update app_data.telegram_link_tokens set expires_at = now() - interval '1 second' where id = $1", [token.id]);
    expect(
      await errorOf(db.service("api.tg_claim_link_token($1, $2, $3, $4, '', '')", [BOT, token.code, TG_STRANGER.user, TG_STRANGER.chat])),
    ).toBe("TOKEN_EXPIRED");
    expect((await status(OTHER)).pending).toBeNull();
  });

  it("validates the default wallet against the chat's budget", async () => {
    expect(await errorOf(db.rpc(OWNER, "api.telegram_set_default_account($1::uuid)", [MEMBER_CASH]))).toBe("ACCOUNT_NOT_FOUND");
    const result = await db.rpc<Status>(OWNER, "api.telegram_set_default_account($1::uuid)", [OWNER_CASH]);
    expect(result.link?.default_account_id).toBe(OWNER_CASH);
    expect((await context(TG_OWNER)).default_account_id).toBe(OWNER_CASH);
  });
});

describe("drafts and commits", () => {
  it("saves a draft once, as a Telegram transaction", async () => {
    const category = await foodCategory(TG_OWNER);
    const draft = await createDraft(TG_OWNER, { amount_rupiah: "20000", account_id: OWNER_CASH, category_id: category });
    expect(draft).toMatchObject({ status: "open", ready: true, account_name: "Tunai", category_name: "Makanan" });

    const first = await commit(TG_OWNER, draft.id, draft.version);
    expect(first.replayed).toBe(false);
    expect(first.transaction).toMatchObject({ id: draft.transaction_id, source: "telegram", created_by: OWNER, amount_rupiah: "20000" });

    // Second click (new update) and a re-delivered update both resolve to the same transaction.
    const second = await commit(TG_OWNER, draft.id, draft.version);
    expect(second.replayed).toBe(true);
    expect(second.transaction?.id).toBe(draft.transaction_id);
    expect(await transactionCount(OWNER, draft.transaction_id)).toBe(1);

    // The transaction shows up in the web reports like any other.
    const dashboard = await db.rpc<{ expense_rupiah: string }>(OWNER, "api.get_dashboard($1::date, $2::date)", [MONTH_START, TOMORROW]);
    expect(dashboard.expense_rupiah).toBe("20000");
    const history = await db.as<{ id: string; source: string }>(
      OWNER,
      "select id, source from api.list_transactions(null, null, null, null, null, null, null, null, null, 50)",
    );
    expect(history).toContainEqual({ id: draft.transaction_id, source: "telegram" });
  });

  it("replays a re-delivered update without applying it twice", async () => {
    const category = await foodCategory(TG_OWNER);
    const update = nextUpdate();
    const message = nextMessage();
    const draft = await createDraft(TG_OWNER, { amount_rupiah: "5000", account_id: OWNER_CASH, category_id: category }, update, message);
    const again = await createDraft(TG_OWNER, { amount_rupiah: "5000", account_id: OWNER_CASH, category_id: category }, update, message);
    expect(again.id).toBe(draft.id);

    const changed = await updateDraft(TG_OWNER, draft, { amount_rupiah: "6000" });
    expect(changed.version).toBe(draft.version + 1);
    // Old version can no longer be saved.
    expect(await errorOf(commit(TG_OWNER, draft.id, draft.version))).toBe("VERSION_CONFLICT");

    const commitUpdate = nextUpdate();
    const saved = await commit(TG_OWNER, changed.id, changed.version, commitUpdate);
    const replayed = await commit(TG_OWNER, changed.id, changed.version, commitUpdate);
    expect(replayed).toEqual(saved);
    expect(saved.transaction?.amount_rupiah).toBe("6000");
  });

  it("asks for missing or ambiguous input before saving", async () => {
    const category = await foodCategory(TG_OWNER);
    const draft = await createDraft(TG_OWNER, { amount_options: ["3000", "9000"], account_id: OWNER_CASH, category_id: category });
    expect(draft.ready).toBe(false);
    expect(await errorOf(commit(TG_OWNER, draft.id, draft.version))).toBe("DRAFT_INCOMPLETE");

    const awaiting = await updateDraft(TG_OWNER, draft, { awaiting_amount: true });
    expect(awaiting.status).toBe("awaiting_amount");
    expect((await context(TG_OWNER)).active_draft?.id).toBe(draft.id);

    const chosen = await updateDraft(TG_OWNER, awaiting, { amount_rupiah: "9000" });
    expect(chosen).toMatchObject({ status: "open", ready: true, amount_rupiah: "9000" });

    // No amount at all: the bot waits for one to be typed.
    const noAmount = await createDraft(TG_OWNER, { account_id: OWNER_CASH, category_id: category });
    expect(noAmount).toMatchObject({ status: "awaiting_amount", ready: false });
    expect(await errorOf(commit(TG_OWNER, noAmount.id, noAmount.version))).toBe("DRAFT_INCOMPLETE");
  });

  it("rejects references and dates the transaction could not be saved with", async () => {
    const category = await foodCategory(TG_OWNER);
    expect(await errorOf(createDraft(TG_OWNER, { amount_rupiah: "1000", account_id: MEMBER_CASH, category_id: category }))).toBe(
      "ACCOUNT_NOT_FOUND",
    );
    expect(
      await errorOf(createDraft(TG_OWNER, { amount_rupiah: "1000", account_id: OWNER_CASH, category_id: category, occurred_on: TOMORROW })),
    ).toBe("DATE_IN_FUTURE");
    expect(await errorOf(createDraft(TG_OWNER, { type: "income", amount_rupiah: "1000", account_id: OWNER_CASH, category_id: category }))).toBe(
      "CATEGORY_TYPE_MISMATCH",
    );
    expect(await errorOf(createDraft(TG_OWNER, { amount_rupiah: "-5", account_id: OWNER_CASH }))).toBe("AMOUNT_INVALID");
  });

  it("does not save expired drafts or drafts of another chat", async () => {
    const category = await foodCategory(TG_OWNER);
    const draft = await createDraft(TG_OWNER, { amount_rupiah: "1000", account_id: OWNER_CASH, category_id: category });
    expect(await errorOf(commit(TG_MEMBER, draft.id, draft.version))).toBe("TELEGRAM_NOT_LINKED");

    await pair(OTHER, TG_STRANGER, "lain");
    expect(await errorOf(commit(TG_STRANGER, draft.id, draft.version))).toBe("DRAFT_NOT_FOUND");

    await db.pg.query("update app_data.telegram_drafts set expires_at = now() - interval '1 second' where id = $1", [draft.id]);
    expect(await errorOf(commit(TG_OWNER, draft.id, draft.version))).toBe("DRAFT_EXPIRED");
  });

  it("never re-creates a transaction deleted on the web", async () => {
    const category = await foodCategory(TG_OWNER);
    const draft = await createDraft(TG_OWNER, { amount_rupiah: "7000", account_id: OWNER_CASH, category_id: category });
    await commit(TG_OWNER, draft.id, draft.version);
    await db.rpc(OWNER, "api.delete_transaction($1::uuid, 1)", [draft.transaction_id]);

    const again = await commit(TG_OWNER, draft.id, draft.version);
    expect(again).toMatchObject({ replayed: true, transaction: null });
    expect(await transactionCount(OWNER, draft.transaction_id)).toBe(0);
  });

  it("a new message cancels the previous open draft", async () => {
    const category = await foodCategory(TG_OWNER);
    const first = await createDraft(TG_OWNER, { amount_rupiah: "1000", account_id: OWNER_CASH, category_id: category });
    const second = await createDraft(TG_OWNER, { amount_rupiah: "2000", account_id: OWNER_CASH, category_id: category });
    expect(await errorOf(commit(TG_OWNER, first.id, first.version))).toBe("DRAFT_CLOSED");
    expect((await context(TG_OWNER)).active_draft?.id).toBe(second.id);

    const cancelled = await db.service<{ cancelled: boolean }>("api.tg_cancel_draft($1, $2, $3, $4, null)", [
      BOT,
      nextUpdate(),
      TG_OWNER.user,
      TG_OWNER.chat,
    ]);
    expect(cancelled.cancelled).toBe(true);
    expect((await context(TG_OWNER)).active_draft).toBeNull();
  });
});

const setBudget = (tg: { user: string; chat: string }, ownerId: string | null, update = nextUpdate()) =>
  db.service<{ budget: { owner_id: string; is_own: boolean } }>("api.tg_set_budget($1, $2, $3, $4, $5::uuid)", [
    BOT,
    update,
    tg.user,
    tg.chat,
    ownerId,
  ]);

describe("shared budgets", () => {
  it("records into the budget chosen in the chat, attributed to the member", async () => {
    await db.rpc(OWNER, "api.invite_budget_member($1::uuid, 'member@example.com')", [INVITE]);
    await db.rpc(MEMBER, "api.respond_budget_invite($1::uuid, true)", [INVITE]);
    await pair(MEMBER, TG_MEMBER, "anggota");

    // Own budget first; the shared one is offered.
    const own = await context(TG_MEMBER);
    expect(own.budget).toMatchObject({ owner_id: MEMBER, is_own: true });
    expect(own.budgets?.map((b) => [b.owner_id, b.is_own])).toEqual([
      [MEMBER, true],
      [OWNER, false],
    ]);

    const switched = await setBudget(TG_MEMBER, OWNER);
    expect(switched.budget).toMatchObject({ owner_id: OWNER, is_own: false });
    const ctx = await context(TG_MEMBER);
    expect(ctx.budget).toMatchObject({ owner_id: OWNER, is_own: false });
    expect(ctx.accounts?.map((a) => a.id)).toEqual([OWNER_CASH, OWNER_BANK]);

    const category = await foodCategory(TG_MEMBER);
    const draft = await createDraft(TG_MEMBER, { amount_rupiah: "15000", account_id: OWNER_BANK, category_id: category });
    const saved = await commit(TG_MEMBER, draft.id, draft.version);
    expect(saved.transaction).toMatchObject({ created_by: MEMBER, source: "telegram" });
    expect(await transactionCount(OWNER, draft.transaction_id)).toBe(1);
  });

  it("is independent of the budget shown on the web", async () => {
    await db.rpc(MEMBER, "api.set_active_budget(null)");
    expect((await context(TG_MEMBER)).budget).toMatchObject({ owner_id: OWNER });
    await db.rpc(MEMBER, "api.set_active_budget($1::uuid)", [OWNER]);
    await setBudget(TG_MEMBER, null);
    expect((await context(TG_MEMBER)).budget).toMatchObject({ owner_id: MEMBER, is_own: true });
    await db.rpc(MEMBER, "api.set_active_budget(null)");
    await setBudget(TG_MEMBER, OWNER);
  });

  it("only offers budgets the user may record into", async () => {
    expect(await errorOf(setBudget(TG_MEMBER, OTHER))).toBe("NOT_FOUND");
    expect(await errorOf(db.rpc(MEMBER, "api.telegram_set_budget($1::uuid)", [OTHER]))).toBe("NOT_FOUND");
  });

  it("sets the default wallet within the chat's budget, and clears it on a switch", async () => {
    const result = await db.service<{ default_account_id: string; account_name: string }>(
      "api.tg_set_default_account($1, $2, $3, $4, $5::uuid)",
      [BOT, nextUpdate(), TG_MEMBER.user, TG_MEMBER.chat, OWNER_CASH],
    );
    expect(result).toMatchObject({ default_account_id: OWNER_CASH, account_name: "Tunai" });
    expect(
      await errorOf(
        db.service("api.tg_set_default_account($1, $2, $3, $4, $5::uuid)", [BOT, nextUpdate(), TG_MEMBER.user, TG_MEMBER.chat, MEMBER_CASH]),
      ),
    ).toBe("ACCOUNT_NOT_FOUND");
    // The web checks against the chat's budget too, not the one it shows.
    expect(await errorOf(db.rpc(MEMBER, "api.telegram_set_default_account($1::uuid)", [MEMBER_CASH]))).toBe("ACCOUNT_NOT_FOUND");

    // Switching budgets from the web: the old default and open drafts go away.
    const category = await foodCategory(TG_MEMBER);
    const draft = await createDraft(TG_MEMBER, { amount_rupiah: "1000", account_id: OWNER_CASH, category_id: category });
    const web = await db.rpc<{ link: { budget: { owner_id: string }; default_account_id: string | null; accounts: { id: string }[] } }>(
      MEMBER,
      "api.telegram_set_budget(null)",
    );
    expect(web.link).toMatchObject({ budget: { owner_id: MEMBER }, default_account_id: null, accounts: [{ id: MEMBER_CASH }] });
    expect(await errorOf(commit(TG_MEMBER, draft.id, draft.version))).toBe("DRAFT_CLOSED");

    await db.rpc(MEMBER, "api.telegram_set_budget($1::uuid)", [OWNER]);
  });

  it("refuses drafts made for a budget the chat no longer records into", async () => {
    const category = await foodCategory(TG_MEMBER);
    const draft = await createDraft(TG_MEMBER, { amount_rupiah: "1000", account_id: OWNER_CASH, category_id: category });
    await db.rpc(OWNER, "api.remove_budget_member($1::uuid)", [INVITE]);

    expect(await errorOf(commit(TG_MEMBER, draft.id, draft.version))).toBe("DRAFT_CLOSED");
    expect((await context(TG_MEMBER)).budget).toMatchObject({ owner_id: MEMBER, is_own: true });
  });

  it("does not switch back on its own after a re-invite", async () => {
    const reinvite = "50000000-0000-4000-8000-000000000002";
    await db.rpc(OWNER, "api.invite_budget_member($1::uuid, 'member@example.com')", [reinvite]);
    await db.rpc(MEMBER, "api.respond_budget_invite($1::uuid, true)", [reinvite]);
    expect((await context(TG_MEMBER)).budget).toMatchObject({ owner_id: MEMBER, is_own: true });
    await db.rpc(MEMBER, "api.remove_budget_member($1::uuid)", [reinvite]);
  });
});

describe("disconnect", () => {
  it("revokes the link from the chat and cancels open drafts", async () => {
    const category = await foodCategory(TG_OWNER);
    const draft = await createDraft(TG_OWNER, { amount_rupiah: "1000", account_id: OWNER_CASH, category_id: category });

    const result = await db.service<{ unlinked: boolean }>("api.tg_unlink($1, $2, $3, $4)", [BOT, nextUpdate(), TG_OWNER.user, TG_OWNER.chat]);
    expect(result.unlinked).toBe(true);
    expect(await context(TG_OWNER)).toEqual({ linked: false });
    expect(await errorOf(commit(TG_OWNER, draft.id, draft.version))).toBe("TELEGRAM_NOT_LINKED");
    expect((await status(OWNER)).link).toBeNull();
  });

  it("re-pairing replaces the previous link from the web", async () => {
    await pair(OWNER, TG_OWNER, "pemilik");
    expect((await context(TG_OWNER)).linked).toBe(true);
    await db.rpc(OWNER, "api.telegram_unlink()");
    expect(await context(TG_OWNER)).toEqual({ linked: false });
  });
});

describe("recent transactions", () => {
  it("lists the active budget's latest transactions", async () => {
    await pair(OWNER, TG_OWNER, "pemilik");
    const rows = await db.service<{ source: string }[]>("api.tg_recent_transactions($1, $2, $3, 5)", [BOT, TG_OWNER.user, TG_OWNER.chat]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);
  });
});
