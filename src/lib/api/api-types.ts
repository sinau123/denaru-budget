// Shapes returned by the api.* RPCs (see supabase/migrations). Money is always
// a digit string; dates are "YYYY-MM-DD"; timestamps are ISO strings.

export type AccountType = "cash" | "bank" | "ewallet";
export type CategoryType = "income" | "expense";
export type TransactionType = "income" | "expense" | "transfer";

export type Profile = {
  id: string;
  display_name: string;
  timezone: string;
  currency: string;
  data_version: string;
  /** About the signed-in user's own wallets (onboarding), not the active budget. */
  has_accounts: boolean;
  today: string;
  /** The budget the app is showing: the user's own, or one shared with them. */
  budget: ActiveBudget;
};

export type ActiveBudget = {
  owner_id: string;
  owner_name: string;
  is_own: boolean;
};

export type BudgetMemberStatus = "pending" | "accepted";

/** Someone the user invited to their own budget. */
export type BudgetMember = {
  id: string;
  email: string;
  status: BudgetMemberStatus;
  created_at: string;
  accepted_at: string | null;
};

/** An invite to, or membership of, someone else's budget. */
export type SharedBudget = {
  id: string;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  status: BudgetMemberStatus;
  created_at: string;
  accepted_at: string | null;
};

export type BudgetSharing = {
  members: BudgetMember[];
  shared_with_me: SharedBudget[];
};

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  opening_balance_rupiah: string;
  opened_on: string;
  archived_at: string | null;
  balance_rupiah: string;
  transaction_count: number;
  earliest_occurred_on: string | null;
  last_used_at: string | null;
  created_at: string;
};

export type Category = {
  id: string;
  name: string;
  type: CategoryType;
  /** Set for sub-categories; the tree is at most two levels deep. */
  parent_id: string | null;
  seed_key: string | null;
  archived_at: string | null;
  created_at: string;
};

export type Transaction = {
  id: string;
  type: TransactionType;
  source: "web" | "telegram";
  amount_rupiah: string;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  occurred_on: string;
  note: string;
  version: number;
  /** User who recorded it; differs from the budget owner in a shared budget. */
  created_by: string | null;
  /** User who last edited it; null until the first edit. */
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  replayed?: boolean;
};

export type TransactionRow = Omit<Transaction, "replayed"> & {
  account_name: string;
  to_account_name: string | null;
  category_name: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
};

export type CategoryTotal = {
  category_id: string;
  name: string;
  archived: boolean;
  total_rupiah: string;
  count: number;
};

/** A top-level category total; children are already included in total_rupiah. */
export type CategoryRollup = CategoryTotal & { children: CategoryTotal[] };

export type Dashboard = {
  from: string;
  to: string;
  income_rupiah: string;
  expense_rupiah: string;
  net_rupiah: string;
  expense_by_category: CategoryRollup[];
  income_by_category: CategoryRollup[];
  daily: { date: string; expense_rupiah: string; income_rupiah: string }[];
};

export type TransactionFilters = {
  from?: string | null;
  to?: string | null;
  type?: TransactionType | null;
  accountId?: string | null;
  categoryId?: string | null;
  search?: string | null;
};

/** One day with at least one matching income/expense (transfers excluded). */
export type DailyTotal = {
  occurred_on: string;
  expense_rupiah: string;
  income_rupiah: string;
  expense_count: number;
  income_count: number;
};

export type TransactionCursor = {
  occurred_on: string;
  created_at: string;
  id: string;
};

export type TransactionInput = {
  type: TransactionType;
  amount_rupiah: string;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  occurred_on: string;
  note: string;
};

/** The Telegram identity connected to the signed-in user (PRD F11). */
export type TelegramLink = {
  id: string;
  telegram_user_id: string;
  username: string;
  first_name: string;
  /** A wallet of `budget`; cleared when the chat switches budgets. */
  default_account_id: string | null;
  /** The budget chat transactions go into, chosen independently of the budget the web shows. */
  budget: TelegramBudget;
  /** Own budget first, then accepted shares. */
  budgets: TelegramBudget[];
  /** Active wallets of `budget`, for the default wallet. */
  accounts: { id: string; name: string }[];
  created_at: string;
};

export type TelegramBudget = { owner_id: string; owner_name: string; is_own: boolean };

/** A pairing code that is still valid; claimed once someone pressed Start in the bot. */
export type TelegramPending = {
  id: string;
  expires_at: string;
  claimed: boolean;
  username: string;
  first_name: string;
};

export type TelegramStatus = {
  link: TelegramLink | null;
  pending: TelegramPending | null;
};

/** The raw code is only returned once, when it is created. */
export type TelegramLinkToken = {
  id: string;
  code: string;
  expires_at: string;
};
