import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e-foundation",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/foundation", open: "never" }],
  ],
  outputDir: "test-results/foundation",
  use: {
    baseURL: "http://127.0.0.1:3101",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    ...(process.env.PDF_BROWSER_MATRIX === "full"
      ? [
          { name: "firefox", use: { ...devices["Desktop Firefox"] } },
          { name: "webkit", use: { ...devices["Desktop Safari"] } },
          { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
        ]
      : []),
  ],
  webServer: [
    {
      command:
        "pnpm exec cross-env PDF_FOUNDATION_TEST=1 NEXT_TELEMETRY_DISABLED=1 next start tests/page-foundation --hostname 127.0.0.1 --port 3101",
      url: "http://127.0.0.1:3101",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        "pnpm exec cross-env PDF_FOUNDATION_TEST=0 NEXT_TELEMETRY_DISABLED=1 next start tests/page-foundation --hostname 127.0.0.1 --port 3102",
      url: "http://127.0.0.1:3102/vendor/pdfjs/6.3.289/manifest.json",
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
