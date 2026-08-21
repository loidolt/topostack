import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "line" : "list",
  outputDir: "test-results",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    // Build in the dedicated "e2e" Vite mode: the deterministic terrain fixture
    // in data-provider.ts requires both VITE_E2E=1 and a non-production mode.
    command: "npm run build -w @topostack/generator -- --mode e2e && npm run preview -w @topostack/generator -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    env: { VITE_E2E: "1" },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
