#!/usr/bin/env node
// Registers the production webhook and the bot's command menu.
//
//   node --env-file=.env.production.local scripts/telegram-set-webhook.mjs
//
// Needs TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and APP_URL (the public
// HTTPS origin of the deployed app). Prints getWebhookInfo afterwards.

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const appUrl = process.env.APP_URL?.replace(/\/+$/, "");

if (!token || !secret || !appUrl) {
  console.error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and APP_URL.");
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  console.error("TELEGRAM_WEBHOOK_SECRET may only contain A-Z, a-z, 0-9, _ and - (max 256).");
  process.exit(1);
}
if (!appUrl.startsWith("https://")) {
  console.error("APP_URL must be HTTPS; Telegram only delivers webhooks over HTTPS.");
  process.exit(1);
}

async function call(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await response.json();
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}

await call("setWebhook", {
  url: `${appUrl}/api/integrations/telegram/webhook`,
  secret_token: secret,
  allowed_updates: ["message", "callback_query"],
  max_connections: 10,
});

await call("setMyCommands", {
  commands: [
    { command: "help", description: "Contoh pesan dan bantuan" },
    { command: "budget", description: "Pilih anggaran tujuan dan dompet default" },
    { command: "last", description: "5 transaksi terakhir" },
    { command: "cancel", description: "Batalkan draft aktif" },
    { command: "disconnect", description: "Putuskan Telegram dari akun" },
    { command: "app", description: "Buka aplikasi web Denaru" },
  ],
});

const info = await call("getWebhookInfo");
console.log({
  url: info.url,
  pending_update_count: info.pending_update_count,
  last_error_date: info.last_error_date,
  last_error_message: info.last_error_message,
});
