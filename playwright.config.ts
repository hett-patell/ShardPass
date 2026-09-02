import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  globalTeardown: "./tests/browser/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      scale: "css",
      maxDiffPixelRatio: 0.002,
      threshold: 0.2,
    },
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}-{platform}{ext}",
  use: {
    baseURL: "http://127.0.0.1:4173",
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "UTC",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm exec vite --config tests/browser/vite-harness.config.ts",
    url: "http://127.0.0.1:4173/tests/fixtures/sites/foundation.html?picker=off",
    reuseExistingServer: false,
  },
});
