import { expect, test } from "@playwright/test";

import { installFakeBackend } from "./fake-backend";

const SHOTS = process.env.E2E_SCREENSHOT_DIR;

async function expectNoHorizontalScroll(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("redirects to login without a session", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Masuk dengan Google" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/login-${test.info().project.name}.png` });
});

test("dashboard shows period totals and current balances", async ({ page }) => {
  await installFakeBackend(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ringkasan" })).toBeVisible();
  const flow = page.getByRole("region", { name: /Arus kas/ });
  await expect(flow.getByText("Rp2.000.000")).toBeVisible();
  await expect(flow.getByText("Rp25.000")).toBeVisible();
  await expect(flow.getByText("+Rp1.975.000")).toBeVisible();
  // 475.000 + 100.000 transfer in; 1.000.000 + 2.000.000 − 100.000
  await expect(page.getByText("Rp575.000")).toBeVisible();
  await expect(page.getByText("Rp2.900.000")).toBeVisible();
  await expect(page.getByText("Rp3.475.000")).toBeVisible();
  await expectNoHorizontalScroll(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dashboard-${test.info().project.name}.png`, fullPage: true });
});

test("adds an expense from the Tambah button", async ({ page }) => {
  const backend = await installFakeBackend(page);
  await page.goto("/transaksi");
  await page.getByRole("button", { name: /Tambah/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Tambah transaksi" })).toBeVisible();
  await dialog.getByLabel("Nominal").fill("18000");
  await dialog.getByLabel("Kategori").selectOption({ label: "Makanan" });
  await dialog.getByLabel("Catatan (opsional)").fill("Kopi susu");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/add-${test.info().project.name}.png` });
  await dialog.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText("Rp18.000 tersimpan.")).toBeVisible();
  await expect(page.getByText("Kopi susu")).toBeVisible();
  expect(backend.calls.filter((c) => c === "create_transaction")).toHaveLength(1);
  await expectNoHorizontalScroll(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/history-${test.info().project.name}.png`, fullPage: true });
});

test("wallets and settings render", async ({ page }) => {
  await installFakeBackend(page);
  await page.goto("/dompet");
  await expect(page.getByRole("heading", { name: "Dompet", exact: true })).toBeVisible();
  await expect(page.getByText("Bank BCA")).toBeVisible();
  await expectNoHorizontalScroll(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/wallets-${test.info().project.name}.png`, fullPage: true });
  await page.goto("/pengaturan");
  await expect(page.getByText("Makanan", { exact: true })).toBeVisible();
  await expect(page.getByText("Sub-kategori Jajan", { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/settings-${test.info().project.name}.png`, fullPage: true });
});

test("new users are sent to onboarding", async ({ page }) => {
  await installFakeBackend(page, { onboarded: false });
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Nama dompet").fill("Tunai");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onboarding-${test.info().project.name}.png` });
  await page.getByRole("button", { name: "Simpan & lanjutkan" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("logout clears the session and cached data", async ({ page }) => {
  await installFakeBackend(page);
  await page.goto("/pengaturan");
  await page.evaluate(() => sessionStorage.setItem("e2e-signed-out", "1"));
  await page.getByRole("button", { name: "Keluar" }).click();
  await expect(page).toHaveURL(/\/login/);
  const leftovers = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("sb-") || k.startsWith("denaru:")));
  expect(leftovers).toEqual([]);
  await page.goBack();
  await expect(page.getByText("Rp2.900.000")).toHaveCount(0);
});

test("switching to English persists across reloads and sign-out", async ({ page }) => {
  await installFakeBackend(page);
  await page.goto("/pengaturan");
  await page.getByRole("radio", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("region", { name: /Cash flow/ }).getByText("Rp2.000.000")).toBeVisible();

  await page.goto("/pengaturan");
  await page.evaluate(() => sessionStorage.setItem("e2e-signed-out", "1"));
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await page.getByRole("radio", { name: "Bahasa Indonesia" }).click();
  await expect(page.getByRole("button", { name: "Masuk dengan Google" })).toBeVisible();
});

test("daily expenses and category filters include sub-categories", async ({ page }) => {
  const backend = await installFakeBackend(page);
  const day = backend.txns[0].occurred_on;
  const now = new Date().toISOString();
  backend.txns.push({ id: "t4", type: "expense", amount_rupiah: "5000", account_id: "acc-cash", to_account_id: null, category_id: "cat-snack", occurred_on: day, note: "Cilok", version: 1, created_at: now, updated_at: now, source: "web", created_by: backend.txns[0].created_by, updated_by: null });

  await page.goto("/");
  const daily = page.getByRole("region", { name: "Pengeluaran harian" });
  await expect(daily.getByText("Tertinggi")).toBeVisible();
  await expect(daily.getByText("Rp30.000").first()).toBeVisible();
  // Makanan rolls up Jajan; the child is listed under it.
  const perCategory = page.getByRole("region", { name: "Per kategori" });
  await expect(perCategory.getByText("Rp30.000")).toBeVisible();
  await expect(perCategory.getByRole("list", { name: "Sub-kategori Makanan" }).getByText("Jajan")).toBeVisible();

  await daily.getByLabel("Kategori pengeluaran harian").selectOption({ label: "Makanan › Jajan" });
  await expect(page).toHaveURL(/kategori=cat-snack/);
  await expect(daily.getByText("Rp5.000").first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/daily-${test.info().project.name}.png`, fullPage: true });

  await page.goto("/transaksi");
  await page.getByLabel("Kategori").selectOption({ label: "Makanan · keluar" });
  await expect(page.getByText("Cilok")).toBeVisible();
  await expect(page.getByText("Nasi padang, es teh")).toBeVisible();
  await expect(page.getByText("Tarik tunai")).toHaveCount(0);
  // The day header shows the whole day's expense for the filter.
  await expect(page.getByText("−Rp30.000")).toBeVisible();

  await page.getByLabel("Kategori").selectOption({ label: "Makanan › Jajan · keluar" });
  await expect(page.getByText("Cilok")).toBeVisible();
  await expect(page.getByText("Nasi padang, es teh")).toHaveCount(0);
});

test("a member switches to a shared budget with view-only wallets", async ({ page }) => {
  const backend = await installFakeBackend(page, { sharedBudget: true });
  await page.goto("/pengaturan");
  await expect(page.getByText("Sari (sari@example.com) mengundang Anda ke anggarannya.")).toBeVisible();

  await page.getByLabel("Anggaran aktif").selectOption({ label: "Anggaran Budi Santoso" });
  await expect(page.getByTestId("shared-budget-banner")).toContainText("Anda sedang memakai anggaran Budi Santoso.");
  expect(backend.calls).toContain("set_active_budget");
  await expect(page.getByText(/Kategori dikelola oleh Budi Santoso/)).toBeVisible();

  await page.goto("/dompet");
  await expect(page.getByText(/Dompet milik Budi Santoso/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Dompet baru" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Arsipkan" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/shared-wallets-${test.info().project.name}.png`, fullPage: true });
});

test("the owner invites someone to their budget", async ({ page }) => {
  const backend = await installFakeBackend(page);
  await page.goto("/pengaturan");
  await page.getByTestId("invite-email").fill("Budi@Example.com");
  await page.getByRole("button", { name: "Undang" }).click();
  await expect(page.getByText(/Undangan untuk budi@example.com dibuat/)).toBeVisible();
  await expect(page.getByTestId("budget-members")).toContainText("Menunggu diterima");
  expect(backend.calls.filter((c) => c === "invite_budget_member")).toHaveLength(1);
  await expectNoHorizontalScroll(page);
});

test("history shows who recorded entries made by someone else", async ({ page }) => {
  await installFakeBackend(page);
  await page.goto("/transaksi?bulan=semua");
  // t3 was recorded by another member, t2 was edited by them; t1 carries no label.
  await expect(page.getByText("Dicatat oleh Budi Santoso", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Dicatat oleh Anda · diubah oleh Budi Santoso", { exact: true })).toHaveCount(1);
  await expect(page.getByText(/Dicatat oleh/)).toHaveCount(2);

  // The edit dialog adds when it was last edited.
  await page.getByText("Dicatat oleh Anda · diubah oleh Budi Santoso").click();
  await expect(page.getByRole("dialog").getByText(/^Dicatat oleh Anda · terakhir diubah oleh Budi Santoso, \d+ \w+ \d{4}, \d{2}:\d{2}$/)).toBeVisible();
});

test("connects Telegram after approving on the web", async ({ page }) => {
  const backend = await installFakeBackend(page);
  await page.goto("/pengaturan");

  await page.getByTestId("telegram-connect").click();
  const botLink = page.getByRole("link", { name: "Buka bot di Telegram" });
  await expect(botLink).toHaveAttribute("href", "https://t.me/denaru_e2e_bot?start=0123456789abcdef0123456789abcdef");

  // The user presses Start in Telegram; the page polls and asks for approval.
  backend.claimTelegram();
  const approval = page.getByTestId("telegram-approve");
  await expect(approval).toContainText("@dewi_l (Dewi)", { timeout: 10_000 });
  await approval.getByRole("button", { name: "Setujui" }).click();

  const connected = page.getByTestId("telegram-connected");
  await expect(connected).toContainText("Terhubung dengan @dewi_l (Dewi).");
  await expect(connected.getByText("Pilih dompet default agar bot tidak menanyakannya setiap kali.")).toBeVisible();
  await page.getByTestId("telegram-default-wallet").selectOption({ label: "Tunai" });
  await expect(page.getByText("Dompet default disimpan.")).toBeVisible();
  expect(backend.telegram.link?.default_account_id).toBe("acc-cash");
  await expectNoHorizontalScroll(page);

  await connected.getByRole("button", { name: "Putuskan" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Putuskan" }).click();
  await expect(page.getByTestId("telegram-connect")).toBeVisible();
});
