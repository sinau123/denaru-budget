// Bot reply texts (Indonesian, Telegram HTML) and inline keyboards. Every
// value that comes from the user (names, notes) is escaped.

import { addDays, formatDateLong, formatDateShort } from "../date-utils";
import { id as dictionary } from "../i18n/dictionary-id";
import { formatRupiah } from "../money-utils";
import type { BotContext, BotDraft, RecentTransaction } from "./bot-db";
import type { InlineKeyboard } from "./telegram-api";

type LinkedContext = Extract<BotContext, { linked: true }>;

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// callback_data (max 64 bytes): "<action>:<draft>:<version>[:<arg>]", with
// UUIDs shortened to 22-character base64url.
// ---------------------------------------------------------------------------

export function shortId(uuid: string): string {
  return Buffer.from(uuid.replace(/-/g, ""), "hex").toString("base64url");
}

export function longId(short: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(short)) return null;
  const hex = Buffer.from(short, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type DraftRef = { draftId: string; version: number };

export type CallbackAction =
  | ({ kind: "save" | "cancel" | "edit" | "back" | "editAmount" | "editCategory" | "editWallet" | "editDate" } & DraftRef)
  | ({ kind: "pickCategory"; categoryId: string } & DraftRef)
  | ({ kind: "pickWallet"; accountId: string } & DraftRef)
  | ({ kind: "pickDate"; date: string } & DraftRef)
  | ({ kind: "pickAmount"; index: number } & DraftRef)
  | { kind: "unlink"; confirm: boolean };

const SIMPLE_CODES = {
  save: "s",
  cancel: "x",
  edit: "e",
  back: "b",
  editAmount: "ea",
  editCategory: "ec",
  editWallet: "ew",
  editDate: "ed",
} as const;
const SIMPLE_KINDS = Object.fromEntries(Object.entries(SIMPLE_CODES).map(([k, v]) => [v, k])) as Record<
  string,
  keyof typeof SIMPLE_CODES
>;

export function encodeCallback(action: CallbackAction): string {
  if (action.kind === "unlink") return `u:${action.confirm ? "y" : "n"}`;
  const ref = `${shortId(action.draftId)}:${action.version}`;
  switch (action.kind) {
    case "pickCategory":
      return `c:${ref}:${shortId(action.categoryId)}`;
    case "pickWallet":
      return `w:${ref}:${shortId(action.accountId)}`;
    case "pickDate":
      return `d:${ref}:${action.date.replace(/-/g, "")}`;
    case "pickAmount":
      return `a:${ref}:${action.index}`;
    default:
      return `${SIMPLE_CODES[action.kind]}:${ref}`;
  }
}

export function decodeCallback(data: string | undefined): CallbackAction | null {
  if (!data) return null;
  const parts = data.split(":");
  if (parts[0] === "u" && parts.length === 2) return { kind: "unlink", confirm: parts[1] === "y" };

  const [code, draft, versionText, arg] = parts;
  const draftId = draft ? longId(draft) : null;
  const version = Number(versionText);
  if (!draftId || !Number.isInteger(version) || version < 1) return null;
  const ref = { draftId, version };

  if (code in SIMPLE_KINDS && parts.length === 3) return { kind: SIMPLE_KINDS[code], ...ref };
  if (parts.length !== 4) return null;
  switch (code) {
    case "c": {
      const categoryId = longId(arg);
      return categoryId ? { kind: "pickCategory", categoryId, ...ref } : null;
    }
    case "w": {
      const accountId = longId(arg);
      return accountId ? { kind: "pickWallet", accountId, ...ref } : null;
    }
    case "d":
      return /^\d{8}$/.test(arg)
        ? { kind: "pickDate", date: `${arg.slice(0, 4)}-${arg.slice(4, 6)}-${arg.slice(6)}`, ...ref }
        : null;
    case "a":
      return /^[0-3]$/.test(arg) ? { kind: "pickAmount", index: Number(arg), ...ref } : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------

const KIND_LABEL = { expense: "Pengeluaran", income: "Pemasukan", transfer: "Transfer" } as const;

function dayLabel(iso: string, today: string): string {
  if (iso === today) return `${formatDateLong(iso, "id")} (hari ini)`;
  if (iso === addDays(today, -1)) return `${formatDateLong(iso, "id")} (kemarin)`;
  return formatDateLong(iso, "id");
}

const missing = "<i>belum dipilih</i>";

export function draftText(draft: BotDraft, today: string, budget?: LinkedContext["budget"]): string {
  const amount = draft.amount_rupiah
    ? `<b>${formatRupiah(draft.amount_rupiah)}</b>`
    : draft.amount_options
      ? "<i>pilih di bawah</i>"
      : "<i>belum diisi</i>";
  const lines = [
    `📝 <b>Draft ${KIND_LABEL[draft.type].toLowerCase()}</b>`,
    `Nominal: ${amount}`,
    `Kategori: ${draft.category_name ? escapeHtml(draft.category_name) : missing}`,
    `Dompet: ${draft.account_name ? escapeHtml(draft.account_name) : missing}`,
    `Tanggal: ${dayLabel(draft.occurred_on, today)}`,
  ];
  if (draft.note) lines.push(`Catatan: ${escapeHtml(draft.note)}`);
  if (budget && !budget.is_own) lines.push(`Anggaran: ${escapeHtml(budget.owner_name || "anggaran bersama")}`);
  lines.push("");
  lines.push(draftPrompt(draft));
  return lines.join("\n");
}

function draftPrompt(draft: BotDraft): string {
  if (draft.status === "awaiting_amount") return "Ketik nominalnya, misalnya <code>25rb</code>.";
  if (draft.amount_options) return "Nominal ini harga total atau harga per item?";
  if (!draft.category_id) return "Pilih kategorinya:";
  if (!draft.account_id) return "Pilih dompetnya:";
  return "Periksa lalu tekan <b>Simpan</b>. Draft berlaku 10 menit.";
}

export function savedText(draft: BotDraft, transactionId: string, appUrl: string, today: string): string {
  return [
    `✅ <b>Tersimpan</b> #${transactionId.slice(0, 8)}`,
    `${KIND_LABEL[draft.type]} ${formatRupiah(draft.amount_rupiah ?? "0")}`,
    `${escapeHtml(draft.category_name ?? "")} · ${escapeHtml(draft.account_name ?? "")} · ${dayLabel(draft.occurred_on, today)}`,
    draft.note ? escapeHtml(draft.note) : null,
    "",
    `<a href="${escapeHtml(`${appUrl}/transaksi`)}">Lihat di aplikasi</a>`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export const texts = {
  help: [
    "Kirim satu transaksi per pesan, misalnya:",
    "• <code>beli nasi 20rb pakai tunai</code>",
    "• <code>bensin 50k pakai BCA</code>",
    "• <code>gaji 5jt ke BCA</code>",
    "• <code>kopi 18rb kemarin</code>",
    "",
    "Nominal: angka penuh, <code>rb</code>, <code>k</code>, atau <code>jt</code> (12,5rb = Rp12.500). Tanpa nama dompet, bot memakai dompet default.",
    "",
    "/last — 5 transaksi terakhir",
    "/cancel — batalkan draft aktif",
    "/disconnect — putuskan Telegram dari akun",
    "/help — bantuan ini",
    "",
    "Koreksi transaksi yang sudah tersimpan dilakukan dari aplikasi web.",
  ].join("\n"),
  notLinked: (appUrl: string) =>
    [
      "Telegram ini belum terhubung ke akun Denaru.",
      `Buka <a href="${escapeHtml(`${appUrl}/pengaturan`)}">Pengaturan</a> → Telegram → <b>Hubungkan Telegram</b>, lalu tekan tautan bot yang muncul.`,
    ].join("\n"),
  claimed:
    "🔗 Permintaan koneksi diterima. Kembali ke aplikasi dan tekan <b>Setujui</b> dalam 5 menit. Setelah itu, kirim transaksi pertama Anda di sini.",
  welcome: "Halo! Bot ini mencatat transaksi ke akun Denaru Anda.\n\n",
  unsupported: "Saat ini bot hanya menerima pesan teks berisi satu transaksi. Ketik /help untuk contoh.",
  unrecognized: "Pesan belum dapat dibaca sebagai transaksi. Sertakan nominal, misalnya <code>makan 25rb</code>. Ketik /help untuk contoh.",
  amountNotUnderstood: "Nominal belum terbaca. Ketik angkanya saja, misalnya <code>25rb</code> atau <code>25000</code>.",
  walletNotFound: "Dompet yang disebut tidak ditemukan. Pilih dompet di bawah.",
  noDefaultWallet: "Tip: atur dompet default di Pengaturan web agar tidak perlu memilih setiap kali.",
  noActiveDraft: "Tidak ada draft aktif.",
  draftCancelled: "❌ Draft dibatalkan. Tidak ada yang disimpan.",
  savedDeleted: "Draft ini sudah pernah disimpan, tetapi transaksinya sudah dihapus di aplikasi. Kirim ulang pesannya jika perlu.",
  noAccounts: "Anggaran aktif belum punya dompet aktif. Tambahkan dompet di aplikasi web terlebih dahulu.",
  noCategories: "Belum ada kategori yang cocok. Tambahkan kategori di aplikasi web terlebih dahulu.",
  chooseField: "Apa yang ingin diubah?",
  chooseCategory: "Pilih kategori:",
  chooseWallet: "Pilih dompet:",
  chooseDate: "Pilih tanggal:",
  typeAmount: "Ketik nominal baru, misalnya <code>25rb</code>.",
  confirmUnlink:
    "Putuskan Telegram dari akun Denaru? Draft yang belum disimpan ikut dibatalkan. Transaksi yang sudah tersimpan tidak terpengaruh.",
  unlinked: "Telegram sudah diputus dari akun. Hubungkan lagi kapan saja dari Pengaturan web.",
  unlinkKept: "Koneksi tetap aktif.",
  recentEmpty: "Belum ada transaksi di anggaran aktif.",
  temporaryFailure: "Layanan sedang terganggu. Coba lagi sebentar lagi, lalu periksa /last sebelum mengirim ulang.",
};

/** Message for a database rejection code (shared with the web dictionary). */
export function rejectionText(code: string): string {
  const codes = dictionary.errors.codes as Record<string, string>;
  return codes[code] ?? codes.UNKNOWN;
}

export function recentText(rows: RecentTransaction[], today: string): string {
  if (rows.length === 0) return texts.recentEmpty;
  const lines = rows.map((row) => {
    const sign = row.type === "income" ? "+" : row.type === "expense" ? "−" : "↔";
    const where =
      row.type === "transfer" ? `${row.account_name} → ${row.to_account_name ?? ""}` : `${row.category_name ?? ""} · ${row.account_name}`;
    const day = row.occurred_on === today ? "hari ini" : formatDateShort(row.occurred_on, "id");
    const note = row.note ? ` — ${escapeHtml(row.note)}` : "";
    const via = row.source === "telegram" ? " ✉️" : "";
    return `${sign} <b>${formatRupiah(row.amount_rupiah)}</b> ${escapeHtml(where)} (${day})${note}${via}`;
  });
  return [`<b>Transaksi terakhir</b>`, ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// Keyboards
// ---------------------------------------------------------------------------

const ref = (draft: BotDraft) => ({ draftId: draft.id, version: draft.version });
const button = (text: string, action: CallbackAction) => ({ text, callback_data: encodeCallback(action) });

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

const cancelRow = (draft: BotDraft) => [button("Batal", { kind: "cancel", ...ref(draft) })];

/** Buttons under a draft: what is missing first, then Simpan/Ubah/Batal. */
export function draftKeyboard(draft: BotDraft, ctx: LinkedContext): InlineKeyboard {
  if (draft.status === "awaiting_amount") return [cancelRow(draft)];
  if (draft.amount_options) {
    const [total, perItem] = draft.amount_options;
    return [
      [button(`Total ${formatRupiah(total)}`, { kind: "pickAmount", index: 0, ...ref(draft) })],
      [button(`Per item → ${formatRupiah(perItem)}`, { kind: "pickAmount", index: 1, ...ref(draft) })],
      cancelRow(draft),
    ];
  }
  if (!draft.category_id) return [...categoryButtons(draft, ctx), cancelRow(draft)];
  if (!draft.account_id) return [...walletButtons(draft, ctx), cancelRow(draft)];
  return [
    [button("✅ Simpan", { kind: "save", ...ref(draft) })],
    [button("Ubah", { kind: "edit", ...ref(draft) }), button("Batal", { kind: "cancel", ...ref(draft) })],
  ];
}

export function editKeyboard(draft: BotDraft): InlineKeyboard {
  return [
    [button("Nominal", { kind: "editAmount", ...ref(draft) }), button("Kategori", { kind: "editCategory", ...ref(draft) })],
    [button("Dompet", { kind: "editWallet", ...ref(draft) }), button("Tanggal", { kind: "editDate", ...ref(draft) })],
    [button("« Kembali", { kind: "back", ...ref(draft) })],
  ];
}

const MAX_CHOICES = 30;

export function categoryButtons(draft: BotDraft, ctx: LinkedContext): InlineKeyboard {
  const choices = ctx.categories
    .filter((c) => c.type === draft.type)
    .slice(0, MAX_CHOICES)
    .map((c) => button(c.parent_name ? `${c.parent_name} › ${c.name}` : c.name, { kind: "pickCategory", categoryId: c.id, ...ref(draft) }));
  return chunk(choices, 2);
}

export function walletButtons(draft: BotDraft, ctx: LinkedContext): InlineKeyboard {
  const choices = ctx.accounts
    .slice(0, MAX_CHOICES)
    .map((a) => button(a.name, { kind: "pickWallet", accountId: a.id, ...ref(draft) }));
  return chunk(choices, 2);
}

export function dateButtons(draft: BotDraft, today: string): InlineKeyboard {
  return [
    [
      button("Hari ini", { kind: "pickDate", date: today, ...ref(draft) }),
      button("Kemarin", { kind: "pickDate", date: addDays(today, -1), ...ref(draft) }),
    ],
    [button(formatDateShort(addDays(today, -2), "id"), { kind: "pickDate", date: addDays(today, -2), ...ref(draft) })],
  ];
}

export const backRow = (draft: BotDraft) => [button("« Kembali", { kind: "back", ...ref(draft) })];

export const unlinkKeyboard: InlineKeyboard = [
  [button("Ya, putuskan", { kind: "unlink", confirm: true }), button("Tidak", { kind: "unlink", confirm: false })],
];
