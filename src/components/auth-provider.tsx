"use client";

import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { onSessionExpired } from "@/lib/api/rpc-client";
import { clearLocalAppState } from "@/lib/local-state";
import { getSupabase } from "@/lib/supabase-client";

type AuthState =
  | { status: "loading"; session: null; userId: null }
  | { status: "signed-out"; session: null; userId: null; reason?: "expired" }
  | { status: "signed-in"; session: Session; userId: string };

type AuthContextValue = AuthState & {
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: "loading", session: null, userId: null });
  const currentUser = useRef<string | null>(null);

  const applySession = useCallback(
    (session: Session | null, reason?: "expired") => {
      const nextUser = session?.user.id ?? null;
      // Never show cached data from a previous account.
      if (currentUser.current !== nextUser) queryClient.clear();
      currentUser.current = nextUser;
      setState(
        session
          ? { status: "signed-in", session, userId: session.user.id }
          : { status: "signed-out", session: null, userId: null, reason },
      );
    },
    [queryClient],
  );

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => applySession(session));
    const unsubscribeExpired = onSessionExpired(() => {
      void supabase.auth.signOut({ scope: "local" }).finally(() => applySession(null, "expired"));
    });
    return () => {
      sub.subscription.unsubscribe();
      unsubscribeExpired();
    };
  }, [applySession]);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: "openid email profile",
      },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut({ scope: "local" });
    queryClient.clear();
    clearLocalAppState();
    applySession(null);
  }, [applySession, queryClient]);

  const value = useMemo(() => ({ ...state, signInWithGoogle, signOut }), [state, signInWithGoogle, signOut]);
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** For screens rendered only inside the signed-in shell. */
export function useUserId(): string {
  const auth = useAuth();
  if (auth.status !== "signed-in") throw new Error("useUserId requires a signed-in session");
  return auth.userId;
}
