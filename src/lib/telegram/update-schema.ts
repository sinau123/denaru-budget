// The parts of Telegram's Update object the bot uses. Unknown fields are
// dropped; anything that doesn't match is ignored by the webhook.

import { z } from "zod";

const telegramId = z.number().int().safe();

const user = z.object({
  id: telegramId,
  is_bot: z.boolean().optional(),
  username: z.string().optional(),
  first_name: z.string().optional(),
});

const chat = z.object({
  id: telegramId,
  type: z.string(),
});

const message = z.object({
  message_id: telegramId,
  date: z.number().int(),
  chat,
  from: user.optional(),
  text: z.string().max(4096).optional(),
});

const callbackQuery = z.object({
  id: z.string(),
  from: user,
  data: z.string().max(64).optional(),
  message: z
    .object({
      message_id: telegramId,
      chat,
    })
    .optional(),
});

export const updateSchema = z.object({
  update_id: telegramId,
  message: message.optional(),
  callback_query: callbackQuery.optional(),
});

export type TelegramUpdate = z.infer<typeof updateSchema>;
export type TelegramMessage = z.infer<typeof message>;
export type TelegramCallbackQuery = z.infer<typeof callbackQuery>;
export type TelegramUser = z.infer<typeof user>;
