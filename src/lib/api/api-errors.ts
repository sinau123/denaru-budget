// Maps database error codes (RAISE messages in the migrations) to Indonesian
// messages and to the form field they belong to.

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The request may or may not have reached the database (offline, timeout). */
export class NetworkError extends Error {
  constructor(message = "Koneksi terputus atau server tidak merespons.") {
    super(message);
    this.name = "NetworkError";
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super("Sesi berakhir. Silakan masuk kembali.");
    this.name = "SessionExpiredError";
  }
}

const MESSAGES: Record<string, { message: string; field?: string }> = {
  AMOUNT_INVALID: { message: "Nominal harus rupiah bulat lebih dari nol.", field: "amount" },
  AMOUNT_TOO_LARGE: { message: "Nominal terlalu besar (maksimal Rp999 triliun).", field: "amount" },
  NOTE_TOO_LONG: { message: "Catatan maksimal 250 karakter.", field: "note" },
  DATE_INVALID: { message: "Tanggal tidak valid.", field: "occurred_on" },
  DATE_IN_FUTURE: { message: "Tanggal tidak boleh melewati hari ini.", field: "occurred_on" },
  DATE_BEFORE_OPENED: { message: "Tanggal mendahului tanggal mulai dompet.", field: "occurred_on" },
  OPENED_ON_AFTER_TRANSACTIONS: {
    message: "Tanggal mulai tidak boleh melampaui transaksi paling awal di dompet ini.",
    field: "opened_on",
  },
  ACCOUNT_NOT_FOUND: { message: "Dompet tidak ditemukan.", field: "account_id" },
  CATEGORY_NOT_FOUND: { message: "Kategori tidak ditemukan.", field: "category_id" },
  CATEGORY_REQUIRED: { message: "Pilih kategori.", field: "category_id" },
  CATEGORY_PARENT_INVALID: {
    message: "Induk harus kategori utama dengan jenis yang sama (sub-kategori hanya satu tingkat).",
    field: "parent_id",
  },
  CATEGORY_HAS_CHILDREN: { message: "Kategori yang punya sub-kategori tidak bisa dijadikan sub-kategori." },
  CATEGORY_TYPE_MISMATCH: { message: "Jenis kategori tidak sesuai dengan jenis transaksi.", field: "category_id" },
  ARCHIVED_REFERENCE: { message: "Dompet atau kategori yang diarsipkan tidak dapat dipilih." },
  SAME_ACCOUNT: { message: "Dompet asal dan tujuan harus berbeda.", field: "to_account_id" },
  TRANSFER_TARGET_REQUIRED: { message: "Pilih dompet tujuan.", field: "to_account_id" },
  TRANSFER_HAS_CATEGORY: { message: "Transfer tidak memakai kategori." },
  TARGET_NOT_ALLOWED: { message: "Dompet tujuan hanya untuk transfer." },
  TYPE_INVALID: { message: "Jenis tidak valid." },
  TYPE_IMMUTABLE: { message: "Jenis transaksi tidak dapat diubah. Hapus lalu buat transaksi baru." },
  NAME_INVALID: { message: "Nama wajib diisi, maksimal 50 karakter.", field: "name" },
  VERSION_CONFLICT: { message: "Transaksi sudah berubah di perangkat lain. Muat ulang data terbaru lalu coba lagi." },
  IDEMPOTENCY_CONFLICT: {
    message: "Data dengan ID yang sama sudah tersimpan dengan isi berbeda. Muat ulang lalu periksa riwayat.",
  },
  NOT_FOUND: { message: "Data tidak ditemukan. Mungkin sudah dihapus." },
  ACCOUNT_HAS_TRANSACTIONS: { message: "Dompet yang sudah memiliki transaksi tidak dapat dihapus. Arsipkan saja." },
  PERIOD_INVALID: { message: "Periode tidak valid." },
  CURSOR_INVALID: { message: "Halaman data tidak valid. Muat ulang." },
  ID_REQUIRED: { message: "Permintaan tidak lengkap. Muat ulang halaman." },
  IMMUTABLE_FIELD: { message: "Data ini tidak dapat diubah." },
  NOT_AUTHENTICATED: { message: "Sesi berakhir. Silakan masuk kembali." },
};

export function toApiError(code: string): ApiError {
  const known = MESSAGES[code];
  if (known) return new ApiError(code, known.message, known.field);
  return new ApiError("UNKNOWN", "Terjadi kesalahan. Coba lagi beberapa saat lagi.");
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof NetworkError || error instanceof SessionExpiredError) {
    return error.message;
  }
  return "Terjadi kesalahan. Coba lagi beberapa saat lagi.";
}
