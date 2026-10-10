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
  await expect(page.getByText("Makanan")).toBeVisible();
  await expectNoHorizontalScroll(page);
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
