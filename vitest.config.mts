import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
