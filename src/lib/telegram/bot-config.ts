import "server-only";

export type BotConfig = {
  token: string;
  /** Numeric prefix of the bot token; identifies the bot in the database. */
  botId: string;
  webhookSecret: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  /** Public URL of the web app, for links in bot replies. */
  appUrl: string;
};

/**
 * Reads the server-only Telegram settings. Returns null when the integration
 * isn't configured, so the webhook can answer 404 instead of failing.
 */
export function readBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseSecretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!token || !webhookSecret || !supabaseUrl || !supabaseSecretKey) return null;

  const botId = token.split(":")[0];
  if (!/^\d+$/.test(botId)) return null;

  const appUrl = (env.APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  return { token, botId, webhookSecret, supabaseUrl, supabaseSecretKey, appUrl };
}
