import { beforeEach, describe, expect, it, vi } from "vitest";

import { BotDbRejectedError, type BotContext, type BotDb, type BotDraft } from "./bot-db";
import { handleUpdate, type BotDeps } from "./bot-handler";
import { decodeCallback, encodeCallback, type CallbackAction } from "./bot-replies";
import { TelegramRejectedError, TelegramUnavailableError, type InlineKeyboard, type TelegramClient } from "./telegram-api";
import type { TelegramUpdate } from "./update-schema";

const DRAFT_ID = "9b2f6a2e-3c1d-4e5f-8a9b-0c1d2e3f4a5b";
const CASH = "11111111-2222-4333-8444-555555555555";
const FOOD = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const USER = 4242;
const OWN = "0a0a0a0a-0000-4000-8000-000000000001";
const SHARED = "0b0b0b0b-0000-4000-8000-000000000002";
const BUDGETS = [
  { owner_id: OWN, owner_name: "Budi", is_own: true },
  { owner_id: SHARED, owner_name: "Sari", is_own: false },
];
const SENT = Math.floor(new Date("2026-10-12T03:00:00Z").getTime() / 1000);

const draft = (overrides: Partial<BotDraft> = {}): BotDraft => ({
  id: DRAFT_ID,
  version: 1,
  status: "open",
  ready: true,
  expired: false,
  type: "expense",
  amount_rupiah: "20000",
  amount_options: null,
  account_id: CASH,
  account_name: "Tunai",
  category_id: FOOD,
  category_name: "Makanan",
  occurred_on: "2026-10-12",
  note: "beli nasi",
  transaction_id: "abcdef01-0000-4000-8000-000000000001",
  expires_at: "2026-10-12T03:10:00Z",
  committed_at: null,
  ...overrides,
});

const linked = (overrides: Partial<Extract<BotContext, { linked: true }>> = {}): BotContext => ({
  linked: true,
  today: "2026-10-12",
  budget: { owner_id: OWN, owner_name: "Budi", is_own: true },
  budgets: [{ owner_id: OWN, owner_name: "Budi", is_own: true }],
  default_account_id: CASH,
  accounts: [{ id: CASH, name: "Tunai", type: "cash", opened_on: "2026-10-01" }],
  categories: [{ id: FOOD, name: "Makanan", type: "expense", seed_key: "expense_food", parent_id: null, parent_name: null }],
  active_draft: null,
  ...overrides,
});

function fakeDb(): { [K in keyof BotDb]: ReturnType<typeof vi.fn> } {
  return {
    receiveUpdate: vi.fn().mockResolvedValue({ replied: false }),
    markReplied: vi.fn().mockResolvedValue(undefined),
    claimLinkToken: vi.fn().mockResolvedValue(undefined),
    getContext: vi.fn().mockResolvedValue(linked()),
    createDraft: vi.fn().mockResolvedValue(draft()),
    updateDraft: vi.fn().mockResolvedValue(draft({ version: 2 })),
    commitDraft: vi.fn(),
    cancelDraft: vi.fn().mockResolvedValue({ cancelled: true }),
    recentTransactions: vi.fn().mockResolvedValue([]),
    unlink: vi.fn().mockResolvedValue({ unlinked: true }),
    setBudget: vi.fn().mockResolvedValue({ budget: BUDGETS[1] }),
    setDefaultAccount: vi.fn().mockResolvedValue({ budget: BUDGETS[1], default_account_id: CASH, account_name: "Tunai" }),
  };
}

function fakeTelegram() {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  };
}

let db: ReturnType<typeof fakeDb>;
let telegram: ReturnType<typeof fakeTelegram>;
let deps: BotDeps;

beforeEach(() => {
  db = fakeDb();
  telegram = fakeTelegram();
  deps = { db: db as unknown as BotDb, telegram: telegram as unknown as TelegramClient, appUrl: "https://app.example" };
});

const textUpdate = (text: string, chatType = "private"): TelegramUpdate => ({
  update_id: 100,
  message: {
    message_id: 7,
    date: SENT,
    chat: { id: USER, type: chatType },
    from: { id: USER, first_name: "Budi", username: "budi" },
    text,
  },
});

const callbackUpdate = (action: CallbackAction | string, from = USER): TelegramUpdate => ({
  update_id: 200,
  callback_query: {
    id: "cb-1",
    from: { id: from },
    data: typeof action === "string" ? action : encodeCallback(action),
    message: { message_id: 55, chat: { id: USER, type: "private" } },
  },
});

const sentKeyboard = (): InlineKeyboard => telegram.sendMessage.mock.calls[0][2]?.keyboard ?? [];
const callbacks = (keyboard: InlineKeyboard) => keyboard.flat().map((b) => decodeCallback(b.callback_data));

describe("callback data", () => {
  it("round-trips every action within Telegram's 64-byte limit", () => {
    const actions: CallbackAction[] = [
      { kind: "save", draftId: DRAFT_ID, version: 12 },
      { kind: "editAmount", draftId: DRAFT_ID, version: 1 },
      { kind: "pickCategory", draftId: DRAFT_ID, version: 999, categoryId: FOOD },
      { kind: "pickWallet", draftId: DRAFT_ID, version: 3, accountId: CASH },
      { kind: "pickDate", draftId: DRAFT_ID, version: 2, date: "2026-10-11" },
      { kind: "pickAmount", draftId: DRAFT_ID, version: 2, index: 1 },
      { kind: "unlink", confirm: true },
      { kind: "pickBudget", ownerId: SHARED },
      { kind: "pickDefaultWallet", accountId: CASH },
    ];
    for (const action of actions) {
      const data = encodeCallback(action);
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      expect(decodeCallback(data)).toEqual(action);
    }
  });

  it("rejects malformed data", () => {
    for (const data of ["", "s", "s:abc:1", `s:${"A".repeat(22)}:0`, "zz:AAAAAAAAAAAAAAAAAAAAAA:1", "a:AAAAAAAAAAAAAAAAAAAAAA:1:9", "g:short", "dw:"]) {
      expect(decodeCallback(data)).toBeNull();
    }
  });
});

describe("delivery", () => {
  it("does nothing for an update that was already answered", async () => {
    db.receiveUpdate.mockResolvedValue({ replied: true });
    expect(await handleUpdate(textUpdate("kopi 18rb"), deps)).toBe("duplicate");
    expect(db.getContext).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("ignores group chats but acknowledges them", async () => {
    expect(await handleUpdate(textUpdate("kopi 18rb", "group"), deps)).toBe("ignored");
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(db.markReplied).toHaveBeenCalledWith("100");
  });

  it("leaves the update unanswered when Telegram is unavailable, so it is retried", async () => {
    telegram.sendMessage.mockRejectedValue(new TelegramUnavailableError("sendMessage"));
    await expect(handleUpdate(textUpdate("kopi 18rb"), deps)).rejects.toBeInstanceOf(TelegramUnavailableError);
    expect(db.markReplied).not.toHaveBeenCalled();
  });

  it("acknowledges when Telegram permanently rejects the reply", async () => {
    telegram.sendMessage.mockRejectedValue(new TelegramRejectedError("sendMessage", 403));
    await handleUpdate(textUpdate("kopi 18rb"), deps);
    expect(db.markReplied).toHaveBeenCalledWith("100");
  });
});

describe("messages", () => {
  it("asks unknown chats to connect from the web app", async () => {
    db.getContext.mockResolvedValue({ linked: false });
    await handleUpdate(textUpdate("kopi 18rb"), deps);
    expect(db.createDraft).not.toHaveBeenCalled();
    expect(telegram.sendMessage.mock.calls[0][1]).toContain("belum terhubung");
  });

  it("turns a sentence into a draft with Simpan/Ubah/Batal", async () => {
    await handleUpdate(textUpdate("beli nasi 20rb pakai tunai"), deps);
    expect(db.createDraft).toHaveBeenCalledWith(
      "100",
      { telegramUserId: String(USER), chatId: String(USER) },
      "7",
      expect.objectContaining({ amount_rupiah: "20000", account_id: CASH, category_id: FOOD, occurred_on: "2026-10-12" }),
    );
    expect(callbacks(sentKeyboard()).map((a) => a?.kind)).toEqual(["save", "edit", "cancel"]);
  });

  it("uses a typed amount for a draft that is waiting for one", async () => {
    db.getContext.mockResolvedValue(linked({ active_draft: draft({ status: "awaiting_amount", amount_rupiah: null, version: 3 }) }));
    await handleUpdate(textUpdate("25rb"), deps);
    expect(db.updateDraft).toHaveBeenCalledWith("100", expect.anything(), DRAFT_ID, 3, { amount_rupiah: "25000" });
    expect(db.createDraft).not.toHaveBeenCalled();
  });

  it("offers total or per item for an ambiguous amount", async () => {
    db.createDraft.mockResolvedValue(draft({ amount_rupiah: null, amount_options: ["3000", "9000"], ready: false }));
    await handleUpdate(textUpdate("beli 3 burger 3000"), deps);
    expect(callbacks(sentKeyboard()).map((a) => a?.kind)).toEqual(["pickAmount", "pickAmount", "cancel"]);
  });

  it("explains database rejections", async () => {
    db.createDraft.mockRejectedValue(new BotDbRejectedError("DATE_BEFORE_OPENED"));
    await handleUpdate(textUpdate("kopi 18rb kemarin"), deps);
    expect(telegram.sendMessage.mock.calls[0][1]).toContain("tanggal mulai dompet");
    expect(db.markReplied).toHaveBeenCalled();
  });

  it("claims a pairing code from /start", async () => {
    await handleUpdate(textUpdate("/start 0123456789abcdef0123456789abcdef"), deps);
    expect(db.claimLinkToken).toHaveBeenCalledWith("0123456789abcdef0123456789abcdef", {
      telegramUserId: String(USER),
      chatId: String(USER),
      username: "budi",
      firstName: "Budi",
    });
    expect(telegram.sendMessage.mock.calls[0][1]).toContain("Setujui");
  });

  it("asks for confirmation before /disconnect", async () => {
    await handleUpdate(textUpdate("/disconnect"), deps);
    expect(db.unlink).not.toHaveBeenCalled();
    expect(callbacks(sentKeyboard())).toEqual([
      { kind: "unlink", confirm: true },
      { kind: "unlink", confirm: false },
    ]);
  });

  it("supports /cancel, /last and /help", async () => {
    await handleUpdate(textUpdate("/cancel"), deps);
    expect(db.cancelDraft).toHaveBeenCalledWith("100", expect.anything(), null);
    await handleUpdate(textUpdate("/last"), deps);
    expect(db.recentTransactions).toHaveBeenCalledWith(expect.anything(), 5);
    await handleUpdate(textUpdate("/help"), deps);
    expect(telegram.sendMessage.mock.calls.at(-1)?.[1]).toMatch(/\/app — buka aplikasi web Denaru$/);
  });

  it("shows the web app URL without requiring a linked account", async () => {
    db.getContext.mockResolvedValue({ linked: false });

    await handleUpdate(textUpdate("/app"), deps);

    for (const call of Object.values(db)) expect(call).not.toHaveBeenCalled();
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      String(USER),
      'Aplikasi web Denaru:\n<a href="https://app.example">https://app.example</a>',
    );
  });
});

describe("buttons", () => {
  it("saves with the sender's identity and edits the draft message", async () => {
    db.commitDraft.mockResolvedValue({
      draft: draft({ status: "committed", committed_at: "2026-10-12T03:01:00Z" }),
      transaction: { id: "abcdef01-0000-4000-8000-000000000001", amount_rupiah: "20000" },
      replayed: false,
    });
    await handleUpdate(callbackUpdate({ kind: "save", draftId: DRAFT_ID, version: 1 }), deps);
    expect(db.commitDraft).toHaveBeenCalledWith("200", { telegramUserId: String(USER), chatId: String(USER) }, DRAFT_ID, 1);
    expect(telegram.editMessageText.mock.calls[0][2]).toContain("Tersimpan");
    expect(telegram.editMessageText.mock.calls[0][2]).toContain("#abcdef01");
    expect(telegram.answerCallbackQuery).toHaveBeenCalledWith("cb-1", "Tersimpan");
  });

  it("removes the buttons of a stale draft", async () => {
    db.commitDraft.mockRejectedValue(new BotDbRejectedError("DRAFT_EXPIRED"));
    await handleUpdate(callbackUpdate({ kind: "save", draftId: DRAFT_ID, version: 1 }), deps);
    expect(telegram.editMessageText).toHaveBeenCalledWith(String(USER), "55", expect.stringContaining("kedaluwarsa"), undefined);
  });

  it("refuses edits of a draft that is not the chat's open draft", async () => {
    db.getContext.mockResolvedValue(linked({ active_draft: null }));
    await handleUpdate(callbackUpdate({ kind: "pickWallet", draftId: DRAFT_ID, version: 1, accountId: CASH }), deps);
    expect(db.updateDraft).not.toHaveBeenCalled();
    expect(telegram.editMessageText.mock.calls[0][2]).toContain("tidak berlaku");
  });

  it("changes a field at the current version", async () => {
    db.getContext.mockResolvedValue(linked({ active_draft: draft() }));
    await handleUpdate(callbackUpdate({ kind: "pickDate", draftId: DRAFT_ID, version: 1, date: "2026-10-11" }), deps);
    expect(db.updateDraft).toHaveBeenCalledWith("200", expect.anything(), DRAFT_ID, 1, { occurred_on: "2026-10-11" });
  });

  it("answers unknown or forged button data without touching the database", async () => {
    await handleUpdate(callbackUpdate("s:not-a-draft:1"), deps);
    expect(db.commitDraft).not.toHaveBeenCalled();
    expect(telegram.answerCallbackQuery).toHaveBeenCalledWith("cb-1", "Tombol tidak dikenal.");
  });

  it("disconnects only after the confirmation button", async () => {
    await handleUpdate(callbackUpdate({ kind: "unlink", confirm: true }), deps);
    expect(db.unlink).toHaveBeenCalledWith("200", { telegramUserId: String(USER), chatId: String(USER) });
  });
});

describe("budget choice", () => {
  const who = { telegramUserId: String(USER), chatId: String(USER) };

  it("/budget lists the budgets, marking the one the chat records into", async () => {
    db.getContext.mockResolvedValue(linked({ budgets: BUDGETS }));
    await handleUpdate(textUpdate("/budget"), deps);
    expect(telegram.sendMessage.mock.calls[0][1]).toContain("Anggaran saya");
    expect(sentKeyboard().flat().map((b) => b.text)).toEqual(["✓ Anggaran saya", "Anggaran Sari"]);
    expect(callbacks(sentKeyboard())).toEqual([
      { kind: "pickBudget", ownerId: OWN },
      { kind: "pickBudget", ownerId: SHARED },
    ]);
  });

  it("/budget without shared budgets offers the default wallet instead", async () => {
    db.getContext.mockResolvedValue(linked({ default_account_id: null }));
    await handleUpdate(textUpdate("/budget"), deps);
    expect(telegram.sendMessage.mock.calls[0][1]).toContain("Pilih dompet default");
    expect(callbacks(sentKeyboard())).toEqual([{ kind: "pickDefaultWallet", accountId: CASH }]);
  });

  it("switches the budget and asks for a default wallet when it has none", async () => {
    db.getContext.mockResolvedValue(linked({ budgets: BUDGETS, budget: BUDGETS[1], default_account_id: null }));
    await handleUpdate(callbackUpdate({ kind: "pickBudget", ownerId: SHARED }), deps);
    expect(db.setBudget).toHaveBeenCalledWith("200", who, SHARED);
    const [, , text, options] = telegram.editMessageText.mock.calls[0];
    expect(text).toContain("Anggaran Sari");
    expect(callbacks(options.keyboard)).toEqual([{ kind: "pickDefaultWallet", accountId: CASH }]);
  });

  it("saves the default wallet from the chat", async () => {
    await handleUpdate(callbackUpdate({ kind: "pickDefaultWallet", accountId: CASH }), deps);
    expect(db.setDefaultAccount).toHaveBeenCalledWith("200", who, CASH);
    expect(telegram.editMessageText.mock.calls[0][2]).toContain("Tunai");
    expect(telegram.answerCallbackQuery).toHaveBeenCalledWith("cb-1", "Tersimpan");
  });

  it("refuses a budget the user no longer has access to", async () => {
    db.setBudget.mockRejectedValue(new BotDbRejectedError("NOT_FOUND"));
    await handleUpdate(callbackUpdate({ kind: "pickBudget", ownerId: SHARED }), deps);
    expect(telegram.answerCallbackQuery).toHaveBeenCalledWith("cb-1", expect.stringContaining("tidak ditemukan"));
  });

  it("shows the target budget on drafts when the user has more than one", async () => {
    db.getContext.mockResolvedValue(linked({ budgets: BUDGETS, budget: BUDGETS[1] }));
    await handleUpdate(textUpdate("kopi 18rb"), deps);
    expect(telegram.sendMessage.mock.calls[0][1]).toContain("Anggaran: Sari");
  });
});
