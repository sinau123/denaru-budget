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
  has_accounts: boolean;
  today: string;
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
  created_at: string;
  updated_at: string;
  replayed?: boolean;
};

export type TransactionRow = Omit<Transaction, "replayed"> & {
  account_name: string;
  to_account_name: string | null;
  category_name: string | null;
};

export type CategoryTotal = {
  category_id: string;
  name: string;
  archived: boolean;
  total_rupiah: string;
  count: number;
};

export type Dashboard = {
  from: string;
  to: string;
  income_rupiah: string;
  expense_rupiah: string;
  net_rupiah: string;
  expense_by_category: CategoryTotal[];
  income_by_category: CategoryTotal[];
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
