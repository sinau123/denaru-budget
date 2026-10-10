import { callRpc } from "./rpc-client";
import type {
  Account,
  AccountType,
  Category,
  CategoryType,
  Dashboard,
  Profile,
  Transaction,
  TransactionCursor,
  TransactionFilters,
  TransactionInput,
  TransactionRow,
} from "./api-types";

export const PAGE_SIZE = 50;
export const EXPORT_PAGE_SIZE = 1000;

// Profile -------------------------------------------------------------------

export async function loadProfile(): Promise<Profile> {
  const existing = await callRpc<Profile | null>("get_profile");
  if (existing) return existing;
  return callRpc<Profile>("bootstrap_user", { p_display_name: null });
}

export function bootstrapUser(displayName?: string) {
  return callRpc<Profile>("bootstrap_user", { p_display_name: displayName ?? null });
}

export function updateProfile(displayName: string) {
  return callRpc<Profile>("update_profile", { p_display_name: displayName });
}

// Accounts ------------------------------------------------------------------

export function getAccounts() {
  return callRpc<Account[]>("get_accounts");
}

export type AccountInput = {
  id: string;
  name: string;
  type: AccountType;
  opening_balance_rupiah: string;
  opened_on: string;
};

export function createAccount(input: AccountInput) {
  return callRpc<Account>("create_account", {
    p_id: input.id,
    p_name: input.name,
    p_type: input.type,
    p_opening_balance_rupiah: input.opening_balance_rupiah,
    p_opened_on: input.opened_on,
  });
}

export function updateAccount(input: AccountInput) {
  return callRpc<Account>("update_account", {
    p_id: input.id,
    p_name: input.name,
    p_type: input.type,
    p_opening_balance_rupiah: input.opening_balance_rupiah,
    p_opened_on: input.opened_on,
  });
}

export function setAccountArchived(id: string, archived: boolean) {
  return callRpc<Account>("set_account_archived", { p_id: id, p_archived: archived });
}

export function deleteAccount(id: string) {
  return callRpc<null>("delete_account", { p_id: id });
}

// Categories ----------------------------------------------------------------

export function listCategories() {
  return callRpc<Category[]>("list_categories");
}

export function createCategory(id: string, name: string, type: CategoryType) {
  return callRpc<Category>("create_category", { p_id: id, p_name: name, p_type: type });
}

export function renameCategory(id: string, name: string) {
  return callRpc<Category>("rename_category", { p_id: id, p_name: name });
}

export function setCategoryArchived(id: string, archived: boolean) {
  return callRpc<Category>("set_category_archived", { p_id: id, p_archived: archived });
}

// Transactions --------------------------------------------------------------

export function createTransaction(id: string, input: TransactionInput) {
  return callRpc<Transaction>("create_transaction", {
    p_id: id,
    p_type: input.type,
    p_amount_rupiah: input.amount_rupiah,
    p_account_id: input.account_id,
    p_occurred_on: input.occurred_on,
    p_to_account_id: input.to_account_id,
    p_category_id: input.category_id,
    p_note: input.note,
  });
}

export function getTransaction(id: string) {
  return callRpc<Transaction | null>("get_transaction", { p_id: id });
}

export function updateTransaction(id: string, expectedVersion: number, input: TransactionInput) {
  return callRpc<Transaction>("update_transaction", {
    p_id: id,
    p_expected_version: expectedVersion,
    p_amount_rupiah: input.amount_rupiah,
    p_account_id: input.account_id,
    p_occurred_on: input.occurred_on,
    p_to_account_id: input.to_account_id,
    p_category_id: input.category_id,
    p_note: input.note,
  });
}

export function deleteTransaction(id: string, expectedVersion: number) {
  return callRpc<Transaction>("delete_transaction", { p_id: id, p_expected_version: expectedVersion });
}

function filterArgs(filters: TransactionFilters, cursor: TransactionCursor | null) {
  return {
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_type: filters.type ?? null,
    p_account_id: filters.accountId ?? null,
    p_category_id: filters.categoryId ?? null,
    p_search: filters.search?.trim() || null,
    p_cursor_occurred_on: cursor?.occurred_on ?? null,
    p_cursor_created_at: cursor?.created_at ?? null,
    p_cursor_id: cursor?.id ?? null,
  };
}

export function listTransactions(filters: TransactionFilters, cursor: TransactionCursor | null) {
  return callRpc<TransactionRow[]>("list_transactions", { ...filterArgs(filters, cursor), p_limit: PAGE_SIZE });
}

export function exportTransactionsPage(filters: TransactionFilters, cursor: TransactionCursor | null) {
  return callRpc<TransactionRow[]>("export_transactions", { ...filterArgs(filters, cursor), p_limit: EXPORT_PAGE_SIZE });
}

export function cursorOf(row: TransactionRow): TransactionCursor {
  return { occurred_on: row.occurred_on, created_at: row.created_at, id: row.id };
}

// Dashboard -----------------------------------------------------------------

export function getDashboard(from: string, to: string) {
  return callRpc<Dashboard>("get_dashboard", { p_from: from, p_to: to });
}
