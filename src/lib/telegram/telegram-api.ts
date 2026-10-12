// Minimal Telegram Bot API client over fetch. Logs never include the token,
// chat text or amounts — only the method and the error class.

const TIMEOUT_MS = 8_000;

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type InlineKeyboard = InlineButton[][];

export type MessageOptions = { keyboard?: InlineKeyboard };

export interface TelegramClient {
  sendMessage(chatId: string, html: string, options?: MessageOptions): Promise<void>;
  editMessageText(chatId: string, messageId: string, html: string, options?: MessageOptions): Promise<void>;
  /** Best effort: stops the button's loading state. Never throws. */
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
}

/**
 * Telegram refused the request for a reason a retry won't fix (blocked bot,
 * deleted chat, malformed message). The update is acknowledged anyway.
 */
export class TelegramRejectedError extends Error {
  constructor(
    public readonly method: string,
    public readonly status: number,
  ) {
    super(`TELEGRAM_REJECTED_${status}`);
    this.name = "TelegramRejectedError";
  }
}

/** Network failure, timeout, rate limit or Telegram outage: worth retrying. */
export class TelegramUnavailableError extends Error {
  constructor(public readonly method: string) {
    super("TELEGRAM_UNAVAILABLE");
    this.name = "TelegramUnavailableError";
  }
}

export function createTelegramClient(token: string, fetchImpl: typeof fetch = fetch): TelegramClient {
  async function call(method: string, body: Record<string, unknown>): Promise<void> {
    let response: Response;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      log(method, "NETWORK");
      throw new TelegramUnavailableError(method);
    }
    if (response.ok) return;

    const description = await response
      .json()
      .then((json: { description?: string }) => json.description ?? "")
      .catch(() => "");
    // Editing a message into the same content is not a failure.
    if (response.status === 400 && /message is not modified/i.test(description)) return;
    log(method, `HTTP_${response.status}`);
    if (response.status === 429 || response.status >= 500) throw new TelegramUnavailableError(method);
    throw new TelegramRejectedError(method, response.status);
  }

  const markup = (options?: MessageOptions) =>
    options?.keyboard ? { reply_markup: { inline_keyboard: options.keyboard } } : {};

  return {
    sendMessage: (chatId, html, options) =>
      call("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...markup(options) }),
    editMessageText: (chatId, messageId, html, options) =>
      call("editMessageText", {
        chat_id: chatId,
        message_id: Number(messageId),
        text: html,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...markup(options),
      }),
    answerCallbackQuery: async (callbackQueryId, text) => {
      try {
        await call("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
      } catch {
        // Old queries can no longer be answered; the reply itself matters more.
      }
    },
  };
}

function log(method: string, code: string) {
  if (process.env.NODE_ENV === "test") return;
  console.warn("[telegram]", { method, code });
}
