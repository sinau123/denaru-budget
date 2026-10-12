import { createHash, timingSafeEqual } from "node:crypto";

import { readBotConfig } from "@/lib/telegram/bot-config";
import { createBotDb } from "@/lib/telegram/bot-db";
import { handleUpdate } from "@/lib/telegram/bot-handler";
import { createTelegramClient } from "@/lib/telegram/telegram-api";
import { updateSchema } from "@/lib/telegram/update-schema";

// Telegram webhook (PRD section 11). Telegram retries any non-2xx answer, so:
// 2xx → handled, duplicate, or not something the bot acts on;
// 5xx → a temporary failure; the retry resumes from the stored state.
export const maxDuration = 20;

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const config = readBotConfig();
  if (!config) return new Response(null, { status: 404 });

  if (!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), config.webhookSecret)) {
    return new Response(null, { status: 401 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 200 });
  }
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) return new Response(null, { status: 200 });

  const started = Date.now();
  try {
    const outcome = await handleUpdate(parsed.data, {
      db: createBotDb(config),
      telegram: createTelegramClient(config.token),
      appUrl: config.appUrl,
    });
    return Response.json({ ok: true, outcome });
  } catch (error) {
    // No update content in logs: only the error class and timing.
    console.error("[telegram-webhook]", {
      error: error instanceof Error ? error.name : "unknown",
      durationMs: Date.now() - started,
    });
    return new Response(null, { status: 500 });
  }
}

/** Constant-time comparison of the secret header. */
function sameSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
