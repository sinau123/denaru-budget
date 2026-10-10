"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError, SessionExpiredError } from "@/lib/api/api-errors";

import { AuthProvider } from "./auth-provider";
import { I18nProvider } from "./i18n-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            // Definite rejections and expired sessions are not worth retrying.
            retry: (count, error) =>
              !(error instanceof ApiError) && !(error instanceof SessionExpiredError) && count < 2,
          },
          // Mutations are retried explicitly by the user with the same client ID.
          mutations: { retry: false },
        },
      }),
  );

  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    </I18nProvider>
  );
}
