#!/usr/bin/env node
// Local development without a public URL: long-polls Telegram for updates and
// forwards each one to the local webhook, with the secret header, exactly as
// Telegram would. Updates that get a non-2xx answer are retried.
//
//   pnpm dev                                    # in one terminal
//   node --env-file=.env.local scripts/telegram-dev-poll.mjs
//
// getUpdates does not work while a webhook is set, so this removes the
// webhook first (use a separate test bot, not the production one).

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const target = process.env.TELEGRAM_DEV_TARGET ?? "http://localhost:3000/api/integrations/telegram/webhook";

if (!token || !secret) {
  console.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in .env.local.");
  process.exit(1);
}

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await response.json();
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await telegram("deleteWebhook", { drop_pending_updates: false });
console.log(`Forwarding updates to ${target} (Ctrl+C to stop)`);

let offset = 0;
for (;;) {
  let updates;
  try {
    updates = await telegram("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] });
  } catch (error) {
    console.error(String(error));
    await sleep(3000);
    continue;
  }

  for (const update of updates) {
    for (let attempt = 1; ; attempt++) {
      let status = 0;
      try {
        const response = await fetch(target, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
          body: JSON.stringify(update),
        });
        status = response.status;
      } catch {
        status = 0;
      }
      console.log(`update ${update.update_id} → ${status || "unreachable"}${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
      if (status >= 200 && status < 300) break;
      if (attempt >= 5) {
        console.error(`giving up on update ${update.update_id}`);
        break;
      }
      await sleep(1000 * attempt);
    }
    offset = update.update_id + 1;
  }
}
