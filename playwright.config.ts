import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, authFile } from "./e2e/support/env";

/**
 * Browser-CI (nur Tests, nicht im Image): `npm run build`, dann `npm run e2e`. Die App startet frisch gegen `.e2e-data`
 * (e2e/start-server.mjs), richtet sich über die Ersteinrichtung im Browser ein (e2e/global-setup.ts, mit Demo-Daten) und wird dann in
 * vier Anzeigegrößen geprüft: iPhone/WebKit 390 × 844, Tablet hoch 820 × 1180 und quer 1180 × 820 (beide mit Touch) und Desktop 1440 × 900.
 * Läuft in der Pipeline nur bei Versions-Tags, Pull Requests und von Hand – nicht bei jedem Push (siehe .github/workflows).
 */
const iphone = devices["iPhone 13"];
const chromium = devices["Desktop Chrome"];

export default defineConfig({
  testDir: "./e2e/tests",
  timeout: 120_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  // Baseline-Screenshots: ein Ordner je Projekt, unabhängig vom Betriebssystem (nur auf Linux verbindlich, siehe e2e/tests/screenshots.spec.ts)
  snapshotPathTemplate: "{testDir}/../snapshots/{projectName}/{arg}{ext}",
  updateSnapshots: process.env.E2E_UPDATE_SNAPSHOTS === "1" ? "all" : "none",
  webServer: {
    command: "node e2e/start-server.mjs",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  use: {
    baseURL: BASE_URL,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    storageState: authFile("admin"),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "iphone", use: { ...iphone, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: "tablet-hoch", use: { ...chromium, viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true } },
    { name: "tablet-quer", use: { ...chromium, viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true } },
    { name: "desktop", use: { ...chromium, viewport: { width: 1440, height: 900 } } },
  ],
});
