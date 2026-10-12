// Maps database error codes (RAISE messages in the migrations) to the form
// field they belong to. User-facing text lives in the i18n dictionaries and is
// resolved from the code when the error is displayed.

import type { Dictionary } from "../i18n/dictionary-id";

export const API_ERROR_CODES = [
  "AMOUNT_INVALID",
  "AMOUNT_TOO_LARGE",
  "NOTE_TOO_LONG",
  "DATE_INVALID",
  "DATE_IN_FUTURE",
  "DATE_BEFORE_OPENED",
  "OPENED_ON_AFTER_TRANSACTIONS",
  "ACCOUNT_NOT_FOUND",
  "CATEGORY_NOT_FOUND",
  "CATEGORY_REQUIRED",
  "CATEGORY_PARENT_INVALID",
  "CATEGORY_HAS_CHILDREN",
  "CATEGORY_TYPE_MISMATCH",
  "ARCHIVED_REFERENCE",
  "SAME_ACCOUNT",
  "TRANSFER_TARGET_REQUIRED",
  "TRANSFER_HAS_CATEGORY",
  "TARGET_NOT_ALLOWED",
  "TYPE_INVALID",
  "TYPE_IMMUTABLE",
  "NAME_INVALID",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "NOT_FOUND",
  "ACCOUNT_HAS_TRANSACTIONS",
  "PERIOD_INVALID",
  "CURSOR_INVALID",
  "ID_REQUIRED",
  "IMMUTABLE_FIELD",
  "NOT_AUTHENTICATED",
  "EXPORT_CHANGED",
  "EMAIL_INVALID",
  "INVITE_SELF",
  "INVITE_EXISTS",
  "MEMBER_LIMIT",
  "UNKNOWN",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

const KNOWN_CODES = new Set<string>(API_ERROR_CODES);

const FIELDS: Partial<Record<ApiErrorCode, string>> = {
  AMOUNT_INVALID: "amount",
  AMOUNT_TOO_LARGE: "amount",
  NOTE_TOO_LONG: "note",
  DATE_INVALID: "occurred_on",
  DATE_IN_FUTURE: "occurred_on",
  DATE_BEFORE_OPENED: "occurred_on",
  OPENED_ON_AFTER_TRANSACTIONS: "opened_on",
  ACCOUNT_NOT_FOUND: "account_id",
  CATEGORY_NOT_FOUND: "category_id",
  CATEGORY_REQUIRED: "category_id",
  CATEGORY_PARENT_INVALID: "parent_id",
  CATEGORY_TYPE_MISMATCH: "category_id",
  SAME_ACCOUNT: "to_account_id",
  TRANSFER_TARGET_REQUIRED: "to_account_id",
  NAME_INVALID: "name",
  EMAIL_INVALID: "email",
  INVITE_SELF: "email",
  INVITE_EXISTS: "email",
};

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly field?: string,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

/** The request may or may not have reached the database (offline, timeout, outage). */
export class NetworkError extends Error {
  constructor(public readonly kind: "network" | "service" = "network") {
    super(kind);
    this.name = "NetworkError";
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super("SESSION_EXPIRED");
    this.name = "SessionExpiredError";
  }
}

export function toApiError(code: string): ApiError {
  if (code !== "UNKNOWN" && KNOWN_CODES.has(code)) {
    const known = code as ApiErrorCode;
    return new ApiError(known, FIELDS[known]);
  }
  return new ApiError("UNKNOWN");
}

export function errorMessage(error: unknown, t: Dictionary): string {
  if (error instanceof ApiError) return t.errors.codes[error.code];
  if (error instanceof NetworkError) return t.errors[error.kind];
  if (error instanceof SessionExpiredError) return t.errors.sessionExpired;
  return t.errors.codes.UNKNOWN;
}
