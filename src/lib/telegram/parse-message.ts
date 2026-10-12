// Rule-based parser for chat messages like "beli nasi 20rb pakai tunai".
// It only understands the patterns in the PRD (amount with rb/k/jt, income
// keywords, wallet/category names, "kemarin"); anything unclear is left empty
// so the bot asks instead of guessing. Money stays a digit string (BigInt).

import { z } from "zod";

import { addDays, todayJakarta } from "../date-utils";
import { MAX_RUPIAH } from "../money-utils";

export type ParseAccount = { id: string; name: string; type: "cash" | "bank" | "ewallet" };
export type ParseCategory = {
  id: string;
  name: string;
  type: "income" | "expense";
  seed_key: string | null;
  parent_name: string | null;
};

export type ParseContext = {
  accounts: ParseAccount[];
  categories: ParseCategory[];
  defaultAccountId: string | null;
};

const draftSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount_rupiah: z.string().regex(/^[1-9]\d{0,18}$/).nullable(),
  /** Set when the amount is ambiguous ("3 burger 3000": total or per item). */
  amount_options: z.array(z.string().regex(/^[1-9]\d{0,18}$/)).min(2).max(4).nullable(),
  account_id: z.string().nullable(),
  category_id: z.string().nullable(),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(250),
});

export type DraftInput = z.infer<typeof draftSchema>;

export type ParseResult =
  | { kind: "draft"; draft: DraftInput; walletNotFound: boolean }
  /** No amount and no recognizable words: not a transaction. */
  | { kind: "unrecognized" };

// Shorthand units; a decimal comma or point is allowed only with a unit (12,5rb).
const AMOUNT_RE =
  /(?<![\p{L}\p{N}])(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d{1,2})?)\s*(rb|ribu|k|jt|juta)?(?![\p{L}\p{N}])/giu;
const UNITS: Record<string, bigint> = { rb: 1000n, ribu: 1000n, k: 1000n, jt: 1_000_000n, juta: 1_000_000n };

type AmountToken = { value: bigint; start: number; end: number; hasUnit: boolean; raw: string };

/** Parses one amount match into rupiah, or null when it isn't a whole rupiah value. */
export function parseAmountToken(digits: string, unit: string | undefined): bigint | null {
  const multiplier = unit ? UNITS[unit.toLowerCase()] : 1n;
  let integer = digits;
  let fraction = "";
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(digits)) {
    // Thousands grouping: "20.000", "1,250,000".
    integer = digits.replace(/[.,]/g, "");
  } else if (/[.,]/.test(digits)) {
    if (!unit) return null; // "12,5" without a unit is not whole rupiah
    [integer, fraction] = digits.split(/[.,]/);
  }
  const scale = 10n ** BigInt(fraction.length);
  const scaled = (BigInt(integer) * scale + BigInt(fraction || "0")) * multiplier;
  if (scaled % scale !== 0n) return null;
  const value = scaled / scale;
  if (value <= 0n || value > MAX_RUPIAH) return null;
  return value;
}

function findAmounts(text: string): AmountToken[] {
  const tokens: AmountToken[] = [];
  for (const match of text.matchAll(AMOUNT_RE)) {
    const value = parseAmountToken(match[1], match[2]);
    if (value === null) continue;
    tokens.push({ value, start: match.index, end: match.index + match[0].length, hasUnit: Boolean(match[2]), raw: match[0] });
  }
  return tokens;
}

// Keyword → seed category. User category names are matched first, so a
// custom "Kopi" sub-category wins over the generic food mapping.
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  expense_food: [
    "makan", "makanan", "nasi", "kopi", "ngopi", "sarapan", "minum", "jajan", "snack", "bakso", "mie", "mi",
    "ayam", "burger", "pizza", "warteg", "resto", "restoran", "cafe", "kafe", "teh", "gofood", "grabfood",
    "shopeefood", "roti", "martabak", "sate", "soto",
  ],
  expense_transport: [
    "bensin", "bbm", "pertalite", "pertamax", "solar", "ojek", "ojol", "gojek", "goride", "grab", "gocar",
    "grabcar", "taksi", "taxi", "parkir", "tol", "kereta", "krl", "mrt", "lrt", "busway", "transjakarta", "bus",
    "angkot",
  ],
  expense_shopping: [
    "belanja", "baju", "celana", "sepatu", "sabun", "shopee", "tokopedia", "alfamart", "indomaret", "sayur",
    "pasar", "supermarket",
  ],
  expense_bills: [
    "listrik", "pln", "token", "pdam", "internet", "wifi", "pulsa", "kuota", "tagihan", "sewa", "kos", "kost",
    "kontrakan", "bpjs", "asuransi", "cicilan",
  ],
  expense_entertainment: ["nonton", "bioskop", "film", "netflix", "spotify", "youtube", "game", "hiburan", "karaoke", "liburan"],
  expense_health: ["obat", "dokter", "apotek", "klinik", "vitamin", "periksa", "rs"],
  income_salary: ["gaji", "gajian", "salary"],
  income_other: ["bonus", "thr", "refund", "cashback", "hadiah", "jual", "jualan"],
};

const INCOME_WORDS = new Set(["gaji", "gajian", "salary", "terima", "diterima", "dapat", "dapet", "bonus", "thr", "pemasukan", "masuk", "refund", "cashback", "hadiah", "jual", "jualan"]);

// Words that introduce a wallet: "pakai tunai", "ke BCA", "dari gopay".
const WALLET_PREPOSITIONS = new Set(["pakai", "pake", "pakek", "pk", "dari", "via", "ke", "lewat", "dgn", "dengan", "di"]);
const WALLET_TYPE_WORDS: Record<string, ParseAccount["type"]> = {
  tunai: "cash",
  cash: "cash",
  kas: "cash",
  bank: "bank",
  rekening: "bank",
  ewallet: "ewallet",
  "e-wallet": "ewallet",
};

const DATE_WORDS: Record<string, number> = { kemarin: -1, kmrn: -1, kemaren: -1 };
const TODAY_PHRASE = /\bhari ini\b/giu;

const normalize = (s: string) => s.toLocaleLowerCase("id-ID").replace(/\s+/g, " ").trim();
const words = (s: string) => normalize(s).split(/[^\p{L}\p{N}-]+/u).filter(Boolean);

/** Position of `phrase` as whole words in `text` (both normalized), or -1. */
function wordIndex(text: string, phrase: string): number {
  if (!phrase) return -1;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").exec(text);
  return match ? match.index : -1;
}

type Span = { start: number; end: number };

function matchAccount(text: string, ctx: ParseContext): { accountId: string | null; mentioned: boolean; span: Span | null } {
  // 1. A wallet name anywhere in the message (longest name first).
  const byName = [...ctx.accounts].sort((a, b) => b.name.length - a.name.length);
  for (const account of byName) {
    const name = normalize(account.name);
    const index = wordIndex(text, name);
    if (index >= 0) {
      return { accountId: account.id, mentioned: true, span: withPreposition(text, { start: index, end: index + name.length }) };
    }
  }

  // 2. "pakai tunai" → the only wallet of that type; 3. "pakai <unknown>" → ask.
  const tokens = [...text.matchAll(/[\p{L}\p{N}-]+/gu)];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!WALLET_PREPOSITIONS.has(tokens[i][0])) continue;
    const next = tokens[i + 1];
    const span = { start: tokens[i].index, end: next.index + next[0].length };
    const type = WALLET_TYPE_WORDS[next[0]];
    if (type) {
      const ofType = ctx.accounts.filter((a) => a.type === type);
      return { accountId: ofType.length === 1 ? ofType[0].id : null, mentioned: true, span };
    }
    // "ke"/"di" are too common ("ke kantor", "di warung") to treat as a wallet.
    if (["pakai", "pake", "pakek", "pk", "via", "lewat"].includes(tokens[i][0]) && !/^\d/.test(next[0])) {
      return { accountId: null, mentioned: true, span };
    }
  }
  return { accountId: ctx.defaultAccountId, mentioned: false, span: null };
}

/** Extends a wallet-name span to include a preposition right before it. */
function withPreposition(text: string, span: Span): Span {
  const before = text.slice(0, span.start).match(/([\p{L}]+)\s+$/u);
  if (before && WALLET_PREPOSITIONS.has(before[1])) {
    return { start: span.start - before[0].length, end: span.end };
  }
  return span;
}

function matchCategory(
  text: string,
  type: "income" | "expense" | null,
  ctx: ParseContext,
  exclude: Span[],
): ParseCategory | null {
  const outside = (index: number) => !exclude.some((s) => index >= s.start && index < s.end);
  const candidates = type ? ctx.categories.filter((c) => c.type === type) : ctx.categories;

  // User category names (sub-categories first, they are more specific).
  let best: { category: ParseCategory; index: number } | null = null;
  const ordered = [...candidates].sort((a, b) => Number(Boolean(b.parent_name)) - Number(Boolean(a.parent_name)));
  for (const category of ordered) {
    const index = wordIndex(text, normalize(category.name));
    if (index >= 0 && outside(index) && (!best || index < best.index)) best = { category, index };
  }
  if (best) return best.category;

  // Keywords of the seed categories, earliest in the message wins.
  for (const word of words(text)) {
    for (const [seedKey, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (!keywords.includes(word)) continue;
      const category = candidates.find((c) => c.seed_key === seedKey);
      if (category) return category;
    }
  }
  return null;
}

/**
 * Parses one message. `sentAt` is the Telegram message date, so "kemarin" is
 * relative to when the user sent it, not when the webhook ran.
 */
export function parseMessage(text: string, ctx: ParseContext, sentAt: Date): ParseResult {
  const original = text.trim().slice(0, 500);
  const lower = normalize(original);
  const amounts = findAmounts(lower);

  const wallet = matchAccount(lower, ctx);
  const removed: Span[] = wallet.span ? [wallet.span] : [];

  // Amount: one value, or "<qty> <item> <price>" → total or per item.
  let amount: string | null = null;
  let options: string[] | null = null;
  const usable = amounts.filter((a) => !removed.some((s) => a.start >= s.start && a.start < s.end));
  if (usable.length === 1) {
    amount = usable[0].value.toString();
  } else if (usable.length === 2) {
    const [first, second] = usable;
    const isQuantity = !first.hasUnit && first.value <= 99n && first.value < second.value;
    if (isQuantity && first.value * second.value <= MAX_RUPIAH) {
      options = [second.value.toString(), (first.value * second.value).toString()];
    }
  }
  removed.push(...usable.map((a) => ({ start: a.start, end: a.end })));

  // Date.
  const messageDay = todayJakarta(sentAt);
  let occurredOn = messageDay;
  for (const word of words(lower)) {
    if (word in DATE_WORDS) occurredOn = addDays(messageDay, DATE_WORDS[word]);
  }

  // Type and category.
  const incomeWord = words(lower).some((w) => INCOME_WORDS.has(w));
  const category = matchCategory(lower, incomeWord ? "income" : null, ctx, removed);
  const type: "income" | "expense" = incomeWord ? "income" : (category?.type ?? "expense");
  const typedCategory = category && category.type === type ? category : null;

  if (!amount && !options && usable.length === 0 && !typedCategory && !incomeWord) {
    return { kind: "unrecognized" };
  }

  const note = buildNote(lower, original, removed);
  const draft = draftSchema.parse({
    type,
    amount_rupiah: amount,
    amount_options: options,
    account_id: wallet.accountId,
    category_id: typedCategory?.id ?? null,
    occurred_on: occurredOn,
    note,
  });
  return { kind: "draft", draft, walletNotFound: wallet.mentioned && !wallet.accountId };
}

/** The message without the amount, wallet and date words, in the user's casing. */
function buildNote(lower: string, original: string, removed: Span[]): string {
  // normalize() may collapse whitespace; map spans back only when lengths agree.
  const source = lower.length === original.length ? original : lower;
  let out = "";
  for (let i = 0; i < source.length; i++) {
    if (!removed.some((s) => i >= s.start && i < s.end)) out += source[i];
  }
  out = out.replace(TODAY_PHRASE, " ");
  out = out
    .split(/\s+/)
    .filter((w) => !(normalize(w) in DATE_WORDS))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return out.slice(0, 250);
}

/**
 * Amount typed when the bot asks for one: the message must be just the amount
 * ("25rb", "Rp 9.000"). Anything longer is treated as a new transaction.
 */
export function parseAmountOnly(text: string): string | null {
  const lower = normalize(text);
  const amounts = findAmounts(lower);
  if (amounts.length !== 1) return null;
  const [amount] = amounts;
  return amount.start === 0 && amount.end === lower.length ? amount.value.toString() : null;
}
