// Typed wrappers for the api.tg_* functions (see the Telegram migration).
// They run with the service role and are only reachable from the server.

import { createClient } from "@supabase/supabase-js";

import type { DraftInput } from "./parse-message";

export type TelegramIdentity = { telegramUserId: string; chatId: string };

export type BotDraft = {
  id: string;
  version: number;
  status: "open" | "awaiting_amount" | "committed" | "cancelled";
  ready: boolean;
  expired: boolean;
  type: "income" | "expense";
  amount_rupiah: string | null;
  amount_options: string[] | null;
  account_id: string | null;
  account_name: string | null;
  category_id: string | null;
  category_name: string | null;
  occurred_on: string;
  note: string;
  transaction_id: string;
  expires_at: string;
  committed_at: string | null;
};

export type BotBudget = { owner_id: string; owner_name: string; is_own: boolean };

export type BotContext =
  | { linked: false }
  | {
      linked: true;
      today: string;
      /** The budget the chat records into, chosen with /budget (not the web's active budget). */
      budget: BotBudget;
      /** Own budget first, then accepted shares. */
      budgets: BotBudget[];
      default_account_id: string | null;
      accounts: { id: string; name: string; type: "cash" | "bank" | "ewallet"; opened_on: string }[];
      categories: {
        id: string;
        name: string;
        type: "income" | "expense";
        seed_key: string | null;
        parent_id: string | null;
        parent_name: string | null;
      }[];
      active_draft: BotDraft | null;
    };

export type CommitResult = {
  draft: BotDraft;
  /** Null when the transaction was deleted on the web after it was saved. */
  transaction: { id: string; amount_rupiah: string } | null;
  replayed: boolean;
};

export type RecentTransaction = {
  id: string;
  type: "income" | "expense" | "transfer";
  source: "web" | "telegram";
  amount_rupiah: string;
  account_name: string;
  to_account_name: string | null;
  category_name: string | null;
  occurred_on: string;
  note: string;
};

export type DraftChanges = {
  amount_rupiah?: string;
  account_id?: string;
  category_id?: string;
  occurred_on?: string;
  awaiting_amount?: boolean;
};

export interface BotDb {
  receiveUpdate(updateId: string): Promise<{ replied: boolean }>;
  markReplied(updateId: string): Promise<void>;
  claimLinkToken(code: string, who: TelegramIdentity & { username: string; firstName: string }): Promise<void>;
  getContext(who: TelegramIdentity): Promise<BotContext>;
  createDraft(updateId: string, who: TelegramIdentity, messageId: string, draft: DraftInput): Promise<BotDraft>;
  updateDraft(updateId: string, who: TelegramIdentity, draftId: string, version: number, changes: DraftChanges): Promise<BotDraft>;
  commitDraft(updateId: string, who: TelegramIdentity, draftId: string, version: number): Promise<CommitResult>;
  cancelDraft(updateId: string, who: TelegramIdentity, draftId: string | null): Promise<{ cancelled: boolean; draft?: BotDraft }>;
  recentTransactions(who: TelegramIdentity, limit: number): Promise<RecentTransaction[]>;
  unlink(updateId: string, who: TelegramIdentity): Promise<{ unlinked: boolean }>;
  setBudget(updateId: string, who: TelegramIdentity, ownerId: string): Promise<{ budget: BotBudget }>;
  setDefaultAccount(
    updateId: string,
    who: TelegramIdentity,
    accountId: string,
  ): Promise<{ budget: BotBudget; default_account_id: string; account_name: string }>;
}

/** A definite rejection from the database (RAISE 'CODE'). Shown to the user. */
export class BotDbRejectedError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "BotDbRejectedError";
  }
}

/** The database could not be reached or failed unexpectedly: retry the update. */
export class BotDbUnavailableError extends Error {
  constructor(public readonly operation: string) {
    super("DB_UNAVAILABLE");
    this.name = "BotDbUnavailableError";
  }
}

const TIMEOUT_MS = 8_000;

export function createBotDb(config: { supabaseUrl: string; supabaseSecretKey: string; botId: string }): BotDb {
  const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    db: { schema: "api" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const bot = config.botId;

  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    let result;
    try {
      result = await supabase.rpc(fn, args).abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    } catch {
      log(fn, "NETWORK");
      throw new BotDbUnavailableError(fn);
    }
    const { data, error } = result;
    if (!error) return data as T;
    if (/^[A-Z_]+$/.test(error.message)) {
      throw new BotDbRejectedError(error.message);
    }
    log(fn, error.code || "UNKNOWN");
    throw new BotDbUnavailableError(fn);
  }

  return {
    receiveUpdate: (updateId) => rpc("tg_receive_update", { p_bot_id: bot, p_update_id: updateId }),
    markReplied: (updateId) => rpc("tg_mark_replied", { p_bot_id: bot, p_update_id: updateId }),
    claimLinkToken: (code, who) =>
      rpc("tg_claim_link_token", {
        p_bot_id: bot,
        p_code: code,
        p_telegram_user_id: who.telegramUserId,
        p_chat_id: who.chatId,
        p_username: who.username,
        p_first_name: who.firstName,
      }),
    getContext: (who) =>
      rpc("tg_get_context", { p_bot_id: bot, p_telegram_user_id: who.telegramUserId, p_chat_id: who.chatId }),
    createDraft: (updateId, who, messageId, draft) =>
      rpc("tg_create_draft", {
        p_bot_id: bot,
        p_update_id: updateId,
        p_telegram_user_id: who.telegramUserId,
        p_chat_id: who.chatId,
        p_message_id: messageId,
        p_draft: draft,
      }),
    updateDraft: (updateId, who, draftId, version, changes) =>
      rpc("tg_update_draft", {
        p_bot_id: bot,
        p_update_id: updateId,
        p_telegram_user_id: who.telegramUserId,
        p_chat_id: who.chatId,
        p_draft_id: draftId,
        p_version: version,
        p_changes: changes,
      }),
    commitDraft: (updateId, who, draftId, version) =>
      rpc("tg_commit_draft", {
        p_bot_id: bot,
        p_update_id: updateId,
        p_telegram_user_id: who.telegramUserId,
        p_chat_id: who.chatId,
        p_draft_id: draftId,
        p_version: version,
      }),
    cancelDraft: (updateId, who, draftId) =>
      rpc("tg_cancel_draft", {
        p_bot_id: bot,
        p_update_id: updateId,
        p_telegram_user_id: who.telegramUserId,
        p_chat_id: who.chatId,
        p_draft_id: draftId,
      }),
    recentTransactions: (who, limit) =>
      rpc("tg_recent_transactions", {
        p_bot_id: bot,
        p_telegram_user_id: who.telegramUserId,
        p_chat_id: who.chatId,
        p_limit: limit,
      }),
    unlink: (updateId, who) =>
      rpc("tg_unlink", {
        p_bot_id: bot,
        p_update_id: updateId,
        p_telegram_user_id: who.telegramUserId,
        p_chat_id: who.chatId,
      }),
    setBudget: (updateId, who, ownerId) =>
      rpc("tg_set_budget", {
        p_bot_id: bot,
        p_update_id: updateId,
        p_telegram_user_id: who.telegramUserId,
        p_chat_id: who.chatId,
        p_owner_id: ownerId,
      }),
    setDefaultAccount: (updateId, who, accountId) =>
      rpc("tg_set_default_account", {
        p_bot_id: bot,
        p_update_id: updateId,
        p_telegram_user_id: who.telegramUserId,
        p_chat_id: who.chatId,
        p_account_id: accountId,
      }),
  };
}

function log(operation: string, code: string) {
  if (process.env.NODE_ENV === "test") return;
  console.warn("[telegram-db]", { operation, code });
}
