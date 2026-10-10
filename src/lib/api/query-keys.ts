import type { TransactionFilters } from "./api-types";

// Every key starts with the user ID so caches never mix between accounts and a
// single invalidation of [userId] refreshes everything after a mutation.
export const queryKeys = {
  all: (userId: string) => [userId] as const,
  profile: (userId: string) => [userId, "profile"] as const,
  accounts: (userId: string) => [userId, "accounts"] as const,
  categories: (userId: string) => [userId, "categories"] as const,
  dashboard: (userId: string, month: string) => [userId, "dashboard", month] as const,
  transactions: (userId: string, filters: TransactionFilters) => [userId, "transactions", filters] as const,
};
