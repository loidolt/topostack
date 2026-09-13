import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PUBLIC_APP_URL;
if (!baseURL) throw new Error("PUBLIC_APP_URL is required for the production browser canary.");

export default defineConfig({
  testDir: "./e2e-live",
  fullyParallel: false,
  timeout: 180_000,
  retries: 1,
  workers: 1,
  reporter: "line",
  outputDir: "test-results-live",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
