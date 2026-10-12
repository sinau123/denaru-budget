import type { Page, Route } from "@playwright/test";

export const SUPABASE_URL = "http://127.0.0.1:54399";
const STORAGE_KEY = "sb-127-auth-token";

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

type Txn = {
  id: string; type: "income" | "expense" | "transfer"; amount_rupiah: string; account_id: string;
  to_account_id: string | null; category_id: string | null; occurred_on: string; note: string;
  version: number; created_at: string; updated_at: string; source: "web"; created_by: string; updated_by: string | null;
};

/** A tiny in-memory imitation of the api.* RPCs, enough to drive the UI. */
export async function installFakeBackend(page: Page, opts: { onboarded?: boolean; sharedBudget?: boolean } = {}) {
  const userId = "00000000-0000-4000-8000-0000000000e2";
  const monthStart = `${today().slice(0, 8)}01`;
  const accounts = opts.onboarded === false ? [] : [
    { id: "acc-cash", name: "Tunai", type: "cash", opening_balance_rupiah: "500000", opened_on: monthStart, archived_at: null, created_at: "2026-01-01T00:00:00Z" },
    { id: "acc-bank", name: "Bank BCA", type: "bank", opening_balance_rupiah: "1000000", opened_on: monthStart, archived_at: null, created_at: "2026-01-02T00:00:00Z" },
  ];
  const categories: { id: string; name: string; type: string; parent_id: string | null; seed_key: string | null; archived_at: null; created_at: string }[] = [
    { id: "cat-food", name: "Makanan", type: "expense", parent_id: null, seed_key: "expense_food", archived_at: null, created_at: "" },
    { id: "cat-snack", name: "Jajan", type: "expense", parent_id: "cat-food", seed_key: null, archived_at: null, created_at: "" },
    { id: "cat-transport", name: "Transportasi", type: "expense", parent_id: null, seed_key: "expense_transport", archived_at: null, created_at: "" },
    { id: "cat-salary", name: "Gaji", type: "income", parent_id: null, seed_key: "income_salary", archived_at: null, created_at: "" },
  ];
  // Mirrors app_data.category_scope: a category plus its direct children.
  const inScope = (categoryId: unknown, t: Txn) =>
    !categoryId || t.category_id === categoryId || categories.some((c) => c.id === t.category_id && c.parent_id === categoryId);
  const categoryName = (id: string | null) => {
    const c = categories.find((x) => x.id === id);
    const parent = categories.find((x) => x.id === c?.parent_id);
    return c ? (parent ? `${parent.name} › ${c.name}` : c.name) : null;
  };
  const txns: Txn[] = [];
  let dataVersion = 1;
  const calls: string[] = [];
  // Budget sharing: one accepted share from another user and one pending invite.
  const ownerId = "00000000-0000-4000-8000-0000000000a1";
  const sharedWithMe = opts.sharedBudget
    ? [
        { id: "share-1", owner_id: ownerId, owner_name: "Budi Santoso", owner_email: "budi@example.com", status: "accepted", created_at: "2026-01-01T00:00:00Z", accepted_at: "2026-01-01T00:00:00Z" },
        { id: "share-2", owner_id: "00000000-0000-4000-8000-0000000000a2", owner_name: "Sari", owner_email: "sari@example.com", status: "pending", created_at: "2026-01-02T00:00:00Z", accepted_at: null },
      ]
    : [];
  const members: { id: string; email: string; status: string; created_at: string; accepted_at: string | null }[] = [];
  let activeBudget: string | null = null;

  const people: Record<string, string> = { [userId]: "Dewi Lestari", "00000000-0000-4000-8000-0000000000a1": "Budi Santoso" };
  const add = (t: Omit<Txn, "version" | "created_at" | "updated_at" | "source" | "created_by" | "updated_by">, createdBy = userId, updatedBy: string | null = null) => {
    const now = new Date().toISOString();
    const row: Txn = { ...t, version: 1, created_at: now, updated_at: now, source: "web", created_by: createdBy, updated_by: updatedBy };
    txns.push(row);
    dataVersion++;
    return row;
  };
  if (opts.onboarded !== false) {
    add({ id: "t1", type: "expense", amount_rupiah: "25000", account_id: "acc-cash", to_account_id: null, category_id: "cat-food", occurred_on: monthStart, note: "Nasi padang, es teh" });
    add({ id: "t2", type: "income", amount_rupiah: "2000000", account_id: "acc-bank", to_account_id: null, category_id: "cat-salary", occurred_on: monthStart, note: "" }, userId, "00000000-0000-4000-8000-0000000000a1");
    add({ id: "t3", type: "transfer", amount_rupiah: "100000", account_id: "acc-bank", to_account_id: "acc-cash", category_id: null, occurred_on: monthStart, note: "Tarik tunai" }, "00000000-0000-4000-8000-0000000000a1");
  }

  const balance = (id: string) => {
    const a = accounts.find((x) => x.id === id)!;
    let b = BigInt(a.opening_balance_rupiah);
    for (const t of txns) {
      const v = BigInt(t.amount_rupiah);
      if (t.type === "income" && t.account_id === id) b += v;
      if (t.type === "expense" && t.account_id === id) b -= v;
      if (t.type === "transfer" && t.account_id === id) b -= v;
      if (t.type === "transfer" && t.to_account_id === id) b += v;
    }
    return b.toString();
  };
  const row = (t: Txn) => ({
    ...t,
    account_name: accounts.find((a) => a.id === t.account_id)?.name,
    to_account_name: accounts.find((a) => a.id === t.to_account_id)?.name ?? null,
    category_name: categoryName(t.category_id),
    created_by_name: people[t.created_by] ?? null,
    updated_by_name: t.updated_by ? people[t.updated_by] ?? null : null,
  });

  // Telegram pairing state (PRD F11). claimTelegram() plays the bot receiving /start <code>.
  const telegram: {
    link: {
      id: string;
      telegram_user_id: string;
      username: string;
      first_name: string;
      default_account_id: string | null;
      budget: { owner_id: string; owner_name: string; is_own: boolean };
      budgets: { owner_id: string; owner_name: string; is_own: boolean }[];
      accounts: { id: string; name: string }[];
      created_at: string;
    } | null;
    pending: { id: string; expires_at: string; claimed: boolean; username: string; first_name: string } | null;
  } = { link: null, pending: null };
  const claimTelegram = () => {
    if (telegram.pending) telegram.pending = { ...telegram.pending, claimed: true, username: "dewi_l", first_name: "Dewi" };
  };

  // The chat's budget is chosen separately from the web's active budget.
  const ownTelegramBudget = { owner_id: userId, owner_name: "Dewi Lestari", is_own: true };
  const sharedTelegramBudget = { owner_id: ownerId, owner_name: "Budi Santoso", is_own: false };
  const telegramAccounts = (shared: boolean) =>
    shared ? [{ id: "acc-budi", name: "Kas Budi" }] : accounts.filter((a) => !a.archived_at).map((a) => ({ id: a.id, name: a.name }));

  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    telegram_get_status: () => telegram,
    telegram_create_link_token: () => {
      telegram.pending = { id: "tok-1", expires_at: new Date(Date.now() + 5 * 60_000).toISOString(), claimed: false, username: "", first_name: "" };
      return { id: "tok-1", code: "0123456789abcdef0123456789abcdef", expires_at: telegram.pending.expires_at };
    },
    telegram_confirm_link: () => {
      const p = telegram.pending!;
      telegram.link = {
        id: "link-1", telegram_user_id: "4242", username: p.username, first_name: p.first_name, default_account_id: null,
        budget: ownTelegramBudget, budgets: [ownTelegramBudget, sharedTelegramBudget], accounts: telegramAccounts(false),
        created_at: new Date().toISOString(),
      };
      telegram.pending = null;
      return telegram;
    },
    telegram_reject_link: () => {
      telegram.pending = null;
      return telegram;
    },
    telegram_set_default_account: (a) => {
      telegram.link = { ...telegram.link!, default_account_id: (a.p_account_id as string | null) ?? null };
      return telegram;
    },
    telegram_set_budget: (a) => {
      const shared = a.p_owner_id === ownerId;
      telegram.link = { ...telegram.link!, budget: shared ? sharedTelegramBudget : ownTelegramBudget, accounts: telegramAccounts(shared), default_account_id: null };
      return telegram;
    },
    telegram_unlink: () => {
      telegram.link = null;
      return telegram;
    },
    get_profile: () => ({
      id: userId, display_name: "Dewi Lestari", timezone: "Asia/Jakarta", currency: "IDR", data_version: String(dataVersion), has_accounts: accounts.length > 0, today: today(),
      budget: activeBudget
        ? { owner_id: activeBudget, owner_name: sharedWithMe.find((x) => x.owner_id === activeBudget)!.owner_name, is_own: false }
        : { owner_id: userId, owner_name: "Dewi Lestari", is_own: true },
    }),
    get_budget_sharing: () => ({ members, shared_with_me: sharedWithMe }),
    set_active_budget: (a) => {
      activeBudget = (a.p_owner_id as string | null) || null;
      return handlers.get_profile({});
    },
    invite_budget_member: (a) => {
      const m = { id: a.p_id as string, email: String(a.p_email).trim().toLowerCase(), status: "pending", created_at: new Date().toISOString(), accepted_at: null };
      if (!members.some((x) => x.id === m.id)) members.push(m);
      return m;
    },
    bootstrap_user: () => handlers.get_profile({}),
    get_accounts: () => accounts.map((a) => ({
      ...a, balance_rupiah: balance(a.id),
      transaction_count: txns.filter((t) => t.account_id === a.id || t.to_account_id === a.id).length,
      earliest_occurred_on: null, last_used_at: null,
    })),
    create_account: (a) => {
      const acc = { id: a.p_id as string, name: a.p_name as string, type: a.p_type as string, opening_balance_rupiah: a.p_opening_balance_rupiah as string, opened_on: a.p_opened_on as string, archived_at: null, created_at: new Date().toISOString() };
      accounts.push(acc);
      return acc;
    },
    list_categories: () => categories,
    create_category: (a) => {
      const c = { id: a.p_id as string, name: a.p_name as string, type: a.p_type as string, parent_id: (a.p_parent_id as string) ?? null, seed_key: null, archived_at: null, created_at: new Date().toISOString() };
      categories.push(c);
      return c;
    },
    update_category: (a) => {
      const c = categories.find((x) => x.id === a.p_id)!;
      Object.assign(c, { name: a.p_name, parent_id: a.p_parent_id ?? null });
      return c;
    },
    create_transaction: (a) => {
      const existing = txns.find((t) => t.id === a.p_id);
      if (existing) return { ...existing, replayed: true };
      return add({ id: a.p_id as string, type: a.p_type as Txn["type"], amount_rupiah: a.p_amount_rupiah as string, account_id: a.p_account_id as string, to_account_id: (a.p_to_account_id as string) ?? null, category_id: (a.p_category_id as string) ?? null, occurred_on: a.p_occurred_on as string, note: (a.p_note as string) ?? "" });
    },
    get_transaction: (a) => txns.find((t) => t.id === a.p_id) ?? null,
    list_transactions: (a) => txns
      .filter((t) => !a.p_from || t.occurred_on >= (a.p_from as string))
      .filter((t) => !a.p_to || t.occurred_on < (a.p_to as string))
      .filter((t) => !a.p_type || t.type === a.p_type)
      .filter((t) => !a.p_account_id || t.account_id === a.p_account_id || t.to_account_id === a.p_account_id)
      .filter((t) => inScope(a.p_category_id, t))
      .filter((t) => !a.p_search || t.note.toLowerCase().includes(String(a.p_search).toLowerCase()))
      .slice().reverse().map(row),
    export_transactions: () => txns.slice().reverse().map(row),
    get_daily_totals: (a) => {
      const days = new Map<string, { expense: bigint; income: bigint; ec: number; ic: number }>();
      for (const t of txns) {
        if (t.type === "transfer") continue;
        if (a.p_from && t.occurred_on < (a.p_from as string)) continue;
        if (a.p_to && t.occurred_on >= (a.p_to as string)) continue;
        if (a.p_type && t.type !== a.p_type) continue;
        if (a.p_account_id && t.account_id !== a.p_account_id) continue;
        if (!inScope(a.p_category_id, t)) continue;
        if (a.p_search && !t.note.toLowerCase().includes(String(a.p_search).toLowerCase())) continue;
        const d = days.get(t.occurred_on) ?? { expense: 0n, income: 0n, ec: 0, ic: 0 };
        if (t.type === "expense") { d.expense += BigInt(t.amount_rupiah); d.ec++; } else { d.income += BigInt(t.amount_rupiah); d.ic++; }
        days.set(t.occurred_on, d);
      }
      return [...days].sort(([x], [y]) => (x < y ? 1 : -1)).map(([date, d]) => ({
        occurred_on: date, expense_rupiah: d.expense.toString(), income_rupiah: d.income.toString(), expense_count: d.ec, income_count: d.ic,
      }));
    },
    get_dashboard: (a) => {
      const inPeriod = txns.filter((t) => t.occurred_on >= (a.p_from as string) && t.occurred_on < (a.p_to as string));
      const sum = (type: string) => inPeriod.filter((t) => t.type === type).reduce((s, t) => s + BigInt(t.amount_rupiah), 0n);
      const income = sum("income"), expense = sum("expense");
      const days: { date: string; expense_rupiah: string; income_rupiah: string }[] = [];
      for (let d = new Date(`${a.p_from}T00:00:00Z`); d.toISOString().slice(0, 10) < (a.p_to as string); d.setUTCDate(d.getUTCDate() + 1)) {
        const iso = d.toISOString().slice(0, 10);
        const e = inPeriod.filter((t) => t.type === "expense" && t.occurred_on === iso).reduce((s, t) => s + BigInt(t.amount_rupiah), 0n);
        days.push({ date: iso, expense_rupiah: e.toString(), income_rupiah: "0" });
      }
      const total = (ts: Txn[]) => ts.reduce((s, t) => s + BigInt(t.amount_rupiah), 0n).toString();
      const byCat = categories.filter((c) => c.type === "expense" && !c.parent_id).map((c) => ({
        category_id: c.id, name: c.name, archived: false, count: 1,
        total_rupiah: total(inPeriod.filter((t) => inScope(c.id, t))),
        children: categories.filter((k) => k.parent_id === c.id)
          .map((k) => ({ category_id: k.id, name: k.name, archived: false, count: 1, total_rupiah: total(inPeriod.filter((t) => t.category_id === k.id)) }))
          .filter((k) => k.total_rupiah !== "0"),
      })).filter((c) => c.total_rupiah !== "0");
      return { from: a.p_from, to: a.p_to, income_rupiah: income.toString(), expense_rupiah: expense.toString(), net_rupiah: (income - expense).toString(), expense_by_category: byCat, income_by_category: [], daily: days };
    },
  };

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/*`, async (route: Route) => {
    const fn = new URL(route.request().url()).pathname.split("/").pop()!;
    calls.push(fn);
    const args = route.request().postDataJSON() ?? {};
    const handler = handlers[fn];
    if (!handler) return route.fulfill({ status: 404, json: { code: "PGRST202", message: `no ${fn}` } });
    return route.fulfill({ status: 200, json: handler(args) });
  });
  await page.route(`${SUPABASE_URL}/auth/v1/**`, (route) => route.fulfill({ status: 204, body: "" }));

  // A signed-in session as supabase-js stores it.
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: userId, exp, role: "authenticated" })}.sig`;
  const session = {
    access_token: token, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: exp,
    user: { id: userId, aud: "authenticated", role: "authenticated", email: "dewi@example.com", app_metadata: {}, user_metadata: { full_name: "Dewi Lestari" }, created_at: "2026-01-01T00:00:00Z" },
  };
  await page.addInitScript(([key, value]) => {
    if (!sessionStorage.getItem("e2e-signed-out")) localStorage.setItem(key, value);
  }, [STORAGE_KEY, JSON.stringify(session)] as const);

  return { calls, txns, claimTelegram, telegram };
}
