import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

// Smoke tests run the production build against a mocked Supabase API (see
// tests/e2e/fake-backend.ts). Database rules are covered by tests/db.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 780 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54399",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "e2e-publishable-key",
      NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: "denaru_e2e_bot",
    },
  },
});
