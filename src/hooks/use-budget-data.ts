"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import { useUserId } from "@/components/auth-provider";
import type { TransactionFilters } from "@/lib/api/api-types";
import {
  PAGE_SIZE,
  cursorOf,
  getAccounts,
  getBudgetSharing,
  getDailyTotals,
  getDashboard,
  getTelegramStatus,
  listCategories,
  listTransactions,
  loadProfile,
  setActiveBudget,
} from "@/lib/api/budget-service";
import { queryKeys } from "@/lib/api/query-keys";
import { monthRange } from "@/lib/date-utils";

export function useProfile() {
  const userId = useUserId();
  return useQuery({ queryKey: queryKeys.profile(userId), queryFn: loadProfile });
}

/** The budget the app is showing; undefined until the profile has loaded. */
export function useActiveBudget() {
  return useProfile().data?.budget;
}

export function useBudgetSharing() {
  const userId = useUserId();
  return useQuery({ queryKey: queryKeys.sharing(userId), queryFn: getBudgetSharing });
}

/** Polls every few seconds only while a pairing code is waiting for approval. */
export function useTelegramStatus(enabled = true) {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.telegram(userId),
    queryFn: getTelegramStatus,
    enabled,
    refetchInterval: (query) => (query.state.data?.pending ? 3000 : false),
  });
}

/** Switches the active budget; null means the user's own. */
export function useSwitchBudget() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useCallback(
    async (ownerId: string | null) => {
      const profile = await setActiveBudget(ownerId);
      // useResetOnBudgetChange then drops the previous budget's cached data.
      queryClient.setQueryData(queryKeys.profile(userId), profile);
      return profile;
    },
    [queryClient, userId],
  );
}

/**
 * Budget data keys don't include the budget owner, so whenever the active
 * budget changes (switched here, on another device, or access was revoked)
 * every budget query is reset rather than showing the previous budget's data.
 */
export function useResetOnBudgetChange() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  const ownerId = useActiveBudget()?.owner_id;
  const previous = useRef(ownerId);

  useEffect(() => {
    if (!ownerId || previous.current === ownerId) return;
    const hadBudget = previous.current !== undefined;
    previous.current = ownerId;
    if (!hadBudget) return;
    void queryClient.resetQueries({
      predicate: (q) => q.queryKey[0] === userId && q.queryKey[1] !== "profile" && q.queryKey[1] !== "sharing",
    });
  }, [ownerId, queryClient, userId]);
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
