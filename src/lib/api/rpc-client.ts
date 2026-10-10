import { getSupabase } from "../supabase-client";
import { NetworkError, SessionExpiredError, toApiError } from "./api-errors";

const TIMEOUT_MS = 15_000;
const SESSION_ERROR_CODES = new Set(["PGRST301", "PGRST302", "PGRST303", "28000", "42501"]);

type SessionExpiredListener = () => void;
const sessionListeners = new Set<SessionExpiredListener>();

export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

/**
 * Calls an api.* RPC and normalizes failures:
 * - NetworkError: the outcome is unknown (offline/timeout) — callers must not
 *   claim success and may retry with the same client-generated ID.
 * - SessionExpiredError: stops further requests and sends the user to login.
 * - ApiError: a definite rejection from the database with a known code.
 *
 * Logs never include payloads, amounts or notes — only the operation and code.
 */
export async function callRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    sessionListeners.forEach((l) => l());
    throw new SessionExpiredError();
  }

  const started = performance.now();
  let result;
  try {
    result = await supabase.rpc(fn, args).abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  } catch {
    logFailure(fn, "NETWORK", started);
    throw new NetworkError();
  }

  const { data, error, status } = result;
  if (!error) return data as T;

  if (status === 401 || (SESSION_ERROR_CODES.has(error.code ?? "") && /jwt|permission|authenticat/i.test(error.message))) {
    logFailure(fn, error.code || "401", started);
    sessionListeners.forEach((l) => l());
    throw new SessionExpiredError();
  }
  // supabase-js reports fetch failures and aborts as status 0 without a PG code.
  if (status === 0 || (!error.code && /fetch|network|abort|timeout/i.test(error.message))) {
    logFailure(fn, "NETWORK", started);
    throw new NetworkError();
  }
  if (status >= 500 && !error.code) {
    logFailure(fn, `HTTP_${status}`, started);
    throw new NetworkError("service");
  }

  // RAISE EXCEPTION 'CODE' arrives as message; constraint violations by name.
  const code = /^[A-Z_]+$/.test(error.message) ? error.message : constraintCode(error.code, error.message);
  logFailure(fn, code, started);
  throw toApiError(code);
}

function constraintCode(pgCode: string | undefined, message: string): string {
  if (pgCode === "23514") {
    if (message.includes("note")) return "NOTE_TOO_LONG";
    if (message.includes("amount")) return "AMOUNT_INVALID";
    if (message.includes("name")) return "NAME_INVALID";
  }
  if (pgCode === "23503") return "NOT_FOUND";
  if (pgCode === "22P02" || pgCode === "22007" || pgCode === "22008") return "DATE_INVALID";
  return "UNKNOWN";
}

function logFailure(operation: string, code: string, started: number) {
  if (process.env.NODE_ENV === "test") return;
  const correlationId = crypto.randomUUID().slice(0, 8);
  console.warn("[rpc]", { operation, code, durationMs: Math.round(performance.now() - started), correlationId });
}
