"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useUserId } from "@/components/auth-provider";
import type { TransactionFilters } from "@/lib/api/api-types";
import {
  PAGE_SIZE,
  cursorOf,
  getAccounts,
  getDailyTotals,
  getDashboard,
  listCategories,
  listTransactions,
  loadProfile,
} from "@/lib/api/budget-service";
import { queryKeys } from "@/lib/api/query-keys";
import { monthRange } from "@/lib/date-utils";

export function useProfile() {
  const userId = useUserId();
  return useQuery({ queryKey: queryKeys.profile(userId), queryFn: loadProfile });
}

export function useAccounts() {
  const userId = useUserId();
  return useQuery({ queryKey: queryKeys.accounts(userId), queryFn: getAccounts });
}

export function useCategories() {
  const userId = useUserId();
  return useQuery({ queryKey: queryKeys.categories(userId), queryFn: listCategories });
}

export function useDashboard(month: string) {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.dashboard(userId, month),
    queryFn: () => {
      const { from, to } = monthRange(month);
      return getDashboard(from, to);
    },
    placeholderData: (prev) => prev,
  });
}

export function useTransactions(filters: TransactionFilters) {
  const userId = useUserId();
  return useInfiniteQuery({
    queryKey: queryKeys.transactions(userId, filters),
    queryFn: ({ pageParam }) => listTransactions(filters, pageParam),
    initialPageParam: null as ReturnType<typeof cursorOf> | null,
    getNextPageParam: (lastPage) => (lastPage.length === PAGE_SIZE ? cursorOf(lastPage[lastPage.length - 1]) : undefined),
  });
}

/** Per-day income/expense totals for the same filters as the history. */
export function useDailyTotals(filters: TransactionFilters, enabled = true) {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.dailyTotals(userId, filters),
    queryFn: () => getDailyTotals(filters),
    enabled,
    placeholderData: (prev) => prev,
  });
}

/** Refetches every query of the current user (balances, reports, history). */
export function useInvalidateUserData() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries({ queryKey: queryKeys.all(userId) }), [queryClient, userId]);
}
