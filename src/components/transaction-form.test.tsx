// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NetworkError } from "@/lib/api/api-errors";
import type { Account, Category } from "@/lib/api/api-types";
import { todayJakarta } from "@/lib/date-utils";

const service = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  listCategories: vi.fn(),
  createTransaction: vi.fn(),
  getTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}));
vi.mock("@/lib/api/budget-service", () => service);
vi.mock("./auth-provider", () => ({ useUserId: () => "user-1" }));

import { TransactionForm } from "./transaction-form";

const today = todayJakarta();
const accounts: Account[] = [
  { id: "acc-cash", name: "Tunai", type: "cash", opening_balance_rupiah: "0", opened_on: "2026-01-01", archived_at: null, balance_rupiah: "0", transaction_count: 0, earliest_occurred_on: null, last_used_at: null, created_at: "2026-01-01T00:00:00Z" },
  { id: "acc-bank", name: "Bank", type: "bank", opening_balance_rupiah: "0", opened_on: "2026-01-01", archived_at: null, balance_rupiah: "0", transaction_count: 3, earliest_occurred_on: null, last_used_at: "2026-05-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" },
  { id: "acc-old", name: "Lama", type: "ewallet", opening_balance_rupiah: "0", opened_on: "2026-01-01", archived_at: "2026-02-01T00:00:00Z", balance_rupiah: "0", transaction_count: 1, earliest_occurred_on: null, last_used_at: "2026-09-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" },
];
const categories: Category[] = [
  { id: "cat-food", name: "Makanan", type: "expense", seed_key: "expense_food", archived_at: null, created_at: "" },
  { id: "cat-old", name: "Lama", type: "expense", seed_key: null, archived_at: "2026-02-01T00:00:00Z", created_at: "" },
  { id: "cat-salary", name: "Gaji", type: "income", seed_key: "income_salary", archived_at: null, created_at: "" },
];

function renderForm(onDone = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TransactionForm onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

beforeEach(() => {
  service.getAccounts.mockResolvedValue(accounts);
  service.listCategories.mockResolvedValue(categories);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TransactionForm", () => {
  it("defaults to expense, today, and the last used active wallet; hides archived options", async () => {
    renderForm();
    const wallet = (await screen.findByLabelText("Dompet")) as HTMLSelectElement;
    expect(wallet.value).toBe("acc-bank"); // acc-old was used later but is archived
    expect(screen.queryByRole("option", { name: /Lama/ })).toBeNull();
    expect((screen.getByLabelText("Tanggal") as HTMLInputElement).value).toBe(today);
    expect(screen.getByRole("radio", { name: "Pengeluaran" })).toHaveProperty("ariaChecked", "true");
  });

  it("shows validation messages next to the fields", async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByLabelText("Dompet");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    expect(await screen.findByText("Nominal wajib diisi.")).toBeTruthy();
    expect(screen.getByText("Pilih kategori.")).toBeTruthy();
    expect(service.createTransaction).not.toHaveBeenCalled();
  });

  it("does not create duplicates on double click and keeps one client ID", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    service.createTransaction.mockImplementation(() => new Promise((r) => (resolve = r)));
    const onDone = renderForm();
    await screen.findByLabelText("Dompet");
    await user.type(screen.getByLabelText("Nominal"), "25000");
    await user.selectOptions(screen.getByLabelText("Kategori"), "cat-food");
    const save = screen.getByRole("button", { name: "Simpan" });
    await user.click(save);
    await user.click(save);
    expect(service.createTransaction).toHaveBeenCalledTimes(1);
    const [, input] = service.createTransaction.mock.calls[0];
    expect(input).toMatchObject({ type: "expense", amount_rupiah: "25000", account_id: "acc-bank", category_id: "cat-food", to_account_id: null });
    resolve({ id: "x", amount_rupiah: "25000" });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("after an uncertain save, checks by the same ID before resending", async () => {
    const user = userEvent.setup();
    service.createTransaction.mockRejectedValueOnce(new NetworkError());
    service.getTransaction.mockResolvedValueOnce(null);
    service.createTransaction.mockResolvedValueOnce({ id: "x", amount_rupiah: "5000" });
    const onDone = renderForm();
    await screen.findByLabelText("Dompet");
    await user.type(screen.getByLabelText("Nominal"), "5000");
    await user.selectOptions(screen.getByLabelText("Kategori"), "cat-food");
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    expect(await screen.findByText("Belum dapat dipastikan")).toBeTruthy();
    // Form data is kept.
    expect((screen.getByLabelText("Nominal") as HTMLInputElement).value).toBe("5.000");
    await user.click(screen.getByRole("button", { name: /Periksa/ }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const firstId = service.createTransaction.mock.calls[0][0];
    expect(service.getTransaction).toHaveBeenCalledWith(firstId);
    expect(service.createTransaction.mock.calls[1][0]).toBe(firstId);
  });

  it("treats an already stored transaction as success without resending", async () => {
    const user = userEvent.setup();
    service.createTransaction.mockRejectedValueOnce(new NetworkError());
    service.getTransaction.mockResolvedValueOnce({ id: "x", amount_rupiah: "5000" });
    const onDone = renderForm();
    await screen.findByLabelText("Dompet");
    await user.type(screen.getByLabelText("Nominal"), "5000");
    await user.selectOptions(screen.getByLabelText("Kategori"), "cat-food");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    await user.click(await screen.findByRole("button", { name: /Periksa/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(service.createTransaction).toHaveBeenCalledTimes(1);
  });
});
