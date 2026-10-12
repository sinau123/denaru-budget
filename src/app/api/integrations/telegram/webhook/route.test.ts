import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const handleUpdate = vi.fn();
vi.mock("@/lib/telegram/bot-handler", () => ({ handleUpdate: (...args: unknown[]) => handleUpdate(...args) }));

const { POST } = await import("./route");

const SECRET = "webhook-secret-123";
const ENV = {
  TELEGRAM_BOT_TOKEN: "7000000001:test-token",
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  APP_URL: "https://app.example",
};

function post(body: unknown, secret: string | null = SECRET) {
  return POST(
    new Request("http://localhost/api/integrations/telegram/webhook", {
      method: "POST",
      headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const update = { update_id: 1, message: { message_id: 1, date: 1, chat: { id: 1, type: "private" }, text: "hi" } };

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
  handleUpdate.mockReset().mockResolvedValue("handled");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("telegram webhook", () => {
  it("is not found when the bot isn't configured", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect((await post(update)).status).toBe(404);
  });

  it("rejects a missing or wrong secret token", async () => {
    expect((await post(update, null)).status).toBe(401);
    expect((await post(update, "wrong")).status).toBe(401);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("acknowledges bodies it cannot use without handling them", async () => {
    expect((await post("not json")).status).toBe(200);
    expect((await post({ hello: "world" })).status).toBe(200);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("handles a valid update", async () => {
    const response = await post(update);
    expect(response.status).toBe(200);
    expect(handleUpdate).toHaveBeenCalledWith(expect.objectContaining({ update_id: 1 }), expect.anything());
  });

  it("answers 500 on temporary failures so Telegram retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    handleUpdate.mockRejectedValue(new Error("db down"));
    expect((await post(update)).status).toBe(500);
  });
});
