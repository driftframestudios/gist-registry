import "./node-runtime-admission.mjs";

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: ".artifacts/playwright",
  reporter: [["list"]],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  webServer: {
    command: "node tools/serve-gallery.mjs",
    url: "http://127.0.0.1:4181/gallery.html",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: {
    headless: true,
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
