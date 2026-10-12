import type { TransactionFilters } from "./api-types";

// Every key starts with the user ID so caches never mix between accounts and a
// single invalidation of [userId] refreshes everything after a mutation.
// Budget data keys don't include the active budget; switching budgets resets
// them instead (see useSwitchBudget).
export const queryKeys = {
  all: (userId: string) => [userId] as const,
  profile: (userId: string) => [userId, "profile"] as const,
  sharing: (userId: string) => [userId, "sharing"] as const,
  accounts: (userId: string) => [userId, "accounts"] as const,
  categories: (userId: string) => [userId, "categories"] as const,
  dashboard: (userId: string, month: string) => [userId, "dashboard", month] as const,
  transactions: (userId: string, filters: TransactionFilters) => [userId, "transactions", filters] as const,
  dailyTotals: (userId: string, filters: TransactionFilters) => [userId, "daily-totals", filters] as const,
};
