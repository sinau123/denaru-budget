// Handles one Telegram update: commands, transaction messages and button
// presses. Database steps are idempotent per update (the tg_* functions replay
// a stored result), so a re-delivered update only re-sends the reply.
//
// Errors:
// - BotDbRejectedError: a definite answer from the database → told to the user.
// - BotDbUnavailableError / TelegramUnavailableError: thrown to the webhook,
//   which answers 500 so Telegram retries the update.
// - TelegramRejectedError: the reply can never be delivered (bot blocked,
//   message gone) → the update is acknowledged.

import { todayJakarta } from "../date-utils";
import { BotDbRejectedError, type BotContext, type BotDb, type BotDraft, type TelegramIdentity } from "./bot-db";
import {
  backRow,
  categoryButtons,
  dateButtons,
  decodeCallback,
  draftKeyboard,
  draftText,
  editKeyboard,
  recentText,
  rejectionText,
  savedText,
  texts,
  unlinkKeyboard,
  walletButtons,
  type CallbackAction,
} from "./bot-replies";
import { parseAmountOnly, parseMessage } from "./parse-message";
import { TelegramRejectedError, type InlineKeyboard, type TelegramClient } from "./telegram-api";
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from "./update-schema";

export type BotDeps = {
  db: BotDb;
  telegram: TelegramClient;
  appUrl: string;
};

export type HandleOutcome = "handled" | "duplicate" | "ignored";

type LinkedContext = Extract<BotContext, { linked: true }>;
type Reply = (html: string, keyboard?: InlineKeyboard) => Promise<void>;

// Rejections that make a draft message obsolete: its buttons are removed.
const STALE_DRAFT_CODES = new Set(["DRAFT_NOT_FOUND", "DRAFT_CLOSED", "DRAFT_EXPIRED", "VERSION_CONFLICT", "BUDGET_CHANGED"]);

export async function handleUpdate(update: TelegramUpdate, deps: BotDeps): Promise<HandleOutcome> {
  const updateId = String(update.update_id);
  const { replied } = await deps.db.receiveUpdate(updateId);
  if (replied) return "duplicate";

  let outcome: HandleOutcome = "ignored";
  try {
    if (update.callback_query) {
      outcome = await onCallback(update.callback_query, updateId, deps);
    } else if (update.message) {
      outcome = await onMessage(update.message, updateId, deps);
    }
  } catch (error) {
    if (!(error instanceof TelegramRejectedError)) throw error;
  }
  await deps.db.markReplied(updateId);
  return outcome;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

async function onMessage(message: TelegramMessage, updateId: string, deps: BotDeps): Promise<HandleOutcome> {
  // Private chats with people only; groups are out of scope.
  if (message.chat.type !== "private" || !message.from || message.from.is_bot) return "ignored";

  const who: TelegramIdentity = { telegramUserId: String(message.from.id), chatId: String(message.chat.id) };
  const reply: Reply = (html, keyboard) => deps.telegram.sendMessage(who.chatId, html, keyboard ? { keyboard } : undefined);

  const text = message.text?.trim();
  if (!text) {
    await reply(texts.unsupported);
    return "handled";
  }

  try {
    const command = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
    if (command) {
      await onCommand(command[1].toLowerCase(), command[2]?.trim() ?? "", message, updateId, who, deps, reply);
      return "handled";
    }

    const ctx = await deps.db.getContext(who);
    if (!ctx.linked) {
      await reply(texts.notLinked(deps.appUrl));
      return "handled";
    }
    await onTransactionText(text, message, updateId, who, ctx, deps, reply);
  } catch (error) {
    if (!(error instanceof BotDbRejectedError)) throw error;
    await reply(error.code === "TELEGRAM_NOT_LINKED" ? texts.notLinked(deps.appUrl) : rejectionText(error.code));
  }
  return "handled";
}

async function onCommand(
  name: string,
  arg: string,
  message: TelegramMessage,
  updateId: string,
  who: TelegramIdentity,
  deps: BotDeps,
  reply: Reply,
) {
  switch (name) {
    case "start": {
      if (arg) {
        await deps.db.claimLinkToken(arg, {
          ...who,
          username: message.from?.username ?? "",
          firstName: message.from?.first_name ?? "",
        });
        await reply(texts.claimed);
        return;
      }
      const ctx = await deps.db.getContext(who);
      await reply(texts.welcome + (ctx.linked ? texts.help : texts.notLinked(deps.appUrl)));
      return;
    }
    case "cancel": {
      const result = await deps.db.cancelDraft(updateId, who, null);
      await reply(result.cancelled ? texts.draftCancelled : texts.noActiveDraft);
      return;
    }
    case "last": {
      const ctx = await deps.db.getContext(who);
      if (!ctx.linked) {
        await reply(texts.notLinked(deps.appUrl));
        return;
      }
      const rows = await deps.db.recentTransactions(who, 5);
      await reply(recentText(rows, ctx.today));
      return;
    }
    case "disconnect": {
      const ctx = await deps.db.getContext(who);
      if (ctx.linked) await reply(texts.confirmUnlink, unlinkKeyboard);
      else await reply(texts.notLinked(deps.appUrl));
      return;
    }
    default:
      await reply(texts.help);
  }
}

async function onTransactionText(
  text: string,
  message: TelegramMessage,
  updateId: string,
  who: TelegramIdentity,
  ctx: LinkedContext,
  deps: BotDeps,
  reply: Reply,
) {
  if (ctx.accounts.length === 0) {
    await reply(texts.noAccounts);
    return;
  }

  // The bot asked for an amount and the message is just that amount.
  const active = ctx.active_draft;
  if (active?.status === "awaiting_amount") {
    const amount = parseAmountOnly(text);
    if (amount) {
      const draft = await deps.db.updateDraft(updateId, who, active.id, active.version, { amount_rupiah: amount });
      await reply(draftText(draft, ctx.today, ctx.budget), draftKeyboard(draft, ctx));
      return;
    }
  }

  const parsed = parseMessage(
    text,
    { accounts: ctx.accounts, categories: ctx.categories, defaultAccountId: ctx.default_account_id },
    new Date(message.date * 1000),
  );
  if (parsed.kind === "unrecognized") {
    await reply(active?.status === "awaiting_amount" ? texts.amountNotUnderstood : texts.unrecognized);
    return;
  }

  const draft = await deps.db.createDraft(updateId, who, String(message.message_id), parsed.draft);
  const notes: string[] = [];
  if (parsed.walletNotFound) notes.push(texts.walletNotFound);
  else if (!draft.account_id && !ctx.default_account_id) notes.push(texts.noDefaultWallet);
  const body = draftText(draft, ctx.today, ctx.budget);
  await reply(notes.length ? `${body}\n\n${notes.join("\n")}` : body, draftKeyboard(draft, ctx));
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

async function onCallback(query: TelegramCallbackQuery, updateId: string, deps: BotDeps): Promise<HandleOutcome> {
  const message = query.message;
  if (!message || message.chat.type !== "private" || query.from.is_bot) {
    await deps.telegram.answerCallbackQuery(query.id);
    return "ignored";
  }
  const action = decodeCallback(query.data);
  if (!action) {
    await deps.telegram.answerCallbackQuery(query.id, "Tombol tidak dikenal.");
    return "ignored";
  }

  const who: TelegramIdentity = { telegramUserId: String(query.from.id), chatId: String(message.chat.id) };
  const edit: Reply = (html, keyboard) =>
    deps.telegram.editMessageText(who.chatId, String(message.message_id), html, keyboard ? { keyboard } : undefined);

  try {
    const notice = await runAction(action, updateId, who, deps, edit);
    await deps.telegram.answerCallbackQuery(query.id, notice);
  } catch (error) {
    if (!(error instanceof BotDbRejectedError)) throw error;
    if (error.code === "TELEGRAM_NOT_LINKED") {
      await edit(texts.notLinked(deps.appUrl));
    } else if (STALE_DRAFT_CODES.has(error.code)) {
      await edit(rejectionText(error.code));
    }
    await deps.telegram.answerCallbackQuery(query.id, plain(rejectionText(error.code)));
  }
  return "handled";
}

/** Runs a button action; returns a short toast for the button, if any. */
async function runAction(
  action: CallbackAction,
  updateId: string,
  who: TelegramIdentity,
  deps: BotDeps,
  edit: Reply,
): Promise<string | undefined> {
  const { db } = deps;

  if (action.kind === "unlink") {
    if (!action.confirm) {
      await edit(texts.unlinkKept);
      return undefined;
    }
    await db.unlink(updateId, who);
    await edit(texts.unlinked);
    return undefined;
  }

  switch (action.kind) {
    case "save": {
      const result = await db.commitDraft(updateId, who, action.draftId, action.version);
      if (!result.transaction) {
        await edit(texts.savedDeleted);
        return undefined;
      }
      // "hari ini/kemarin" relative to when it was saved, even on a late retry.
      const savedOn = todayJakarta(result.draft.committed_at ? new Date(result.draft.committed_at) : new Date());
      await edit(savedText(result.draft, result.transaction.id, deps.appUrl, savedOn));
      return "Tersimpan";
    }
    case "cancel": {
      const result = await db.cancelDraft(updateId, who, action.draftId);
      if (result.cancelled) {
        await edit(texts.draftCancelled);
        return undefined;
      }
      throw new BotDbRejectedError("DRAFT_CLOSED");
    }
    default:
      break;
  }

  // The remaining actions show or change the chat's open draft.
  const ctx = await db.getContext(who);
  if (!ctx.linked) throw new BotDbRejectedError("TELEGRAM_NOT_LINKED");
  const draft = ctx.active_draft;
  if (!draft || draft.id !== action.draftId) throw new BotDbRejectedError("DRAFT_CLOSED");
  if (draft.version !== action.version) throw new BotDbRejectedError("VERSION_CONFLICT");

  const show = (d: BotDraft, suffix?: string, keyboard?: InlineKeyboard) =>
    edit(suffix ? `${draftText(d, ctx.today, ctx.budget)}\n\n${suffix}` : draftText(d, ctx.today, ctx.budget), keyboard ?? draftKeyboard(d, ctx));
  const change = async (changes: Parameters<BotDb["updateDraft"]>[4]) => {
    const updated = await db.updateDraft(updateId, who, draft.id, draft.version, changes);
    await show(updated);
  };

  switch (action.kind) {
    case "edit":
      await show(draft, texts.chooseField, editKeyboard(draft));
      return undefined;
    case "back":
      await show(draft);
      return undefined;
    case "editCategory": {
      const buttons = categoryButtons(draft, ctx);
      await show(draft, buttons.length ? texts.chooseCategory : texts.noCategories, [...buttons, backRow(draft)]);
      return undefined;
    }
    case "editWallet":
      await show(draft, texts.chooseWallet, [...walletButtons(draft, ctx), backRow(draft)]);
      return undefined;
    case "editDate":
      await show(draft, texts.chooseDate, [...dateButtons(draft, ctx.today), backRow(draft)]);
      return undefined;
    case "editAmount":
      await change({ awaiting_amount: true });
      return undefined;
    case "pickCategory":
      await change({ category_id: action.categoryId });
      return undefined;
    case "pickWallet":
      await change({ account_id: action.accountId });
      return undefined;
    case "pickDate":
      await change({ occurred_on: action.date });
      return undefined;
    case "pickAmount": {
      const amount = draft.amount_options?.[action.index];
      if (!amount) throw new BotDbRejectedError("VERSION_CONFLICT");
      await change({ amount_rupiah: amount });
      return undefined;
    }
  }
}

/** Toasts are plain text. */
function plain(html: string): string {
  return html.replace(/<[^>]+>/g, "").slice(0, 200);
}
