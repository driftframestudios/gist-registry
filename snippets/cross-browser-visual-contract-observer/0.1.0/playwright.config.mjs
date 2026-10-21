import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: ".artifacts/playwright",
  reporter: [["list"]],
  fullyParallel: false,
  retries: 0,
  webServer: {
    command: "node tools/serve-bound-receiver.mjs",
    url: "http://127.0.0.1:4179/receiver-entry.html",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: {
    headless: true,
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
