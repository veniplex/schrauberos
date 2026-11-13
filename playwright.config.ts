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
const TEXT_ARGS = ["--font-render-hinting=none", "--disable-lcd-text", "--disable-font-subpixel-positioning"];

/**
 * Die Screenshots vergleichen Seiten **mit Daten** (Übersicht, Listen). Laufen sie zwischen den Ablauf-Tests, zeigen sie, was diese gerade angelegt haben (Termine, Kunden, Aufträge mit
 * zufälligen Namen): Jeder Lauf unterschied sich, ein Vergleich mit dem Baseline-Bild war nie stabil. Deshalb zwei Läufe, jeder gegen eine frisch eingerichtete App (`npm run e2e` → scripts/run-e2e.mjs):
 * `E2E_SCREENSHOTS=only` nur die Screenshots (unberührte Demo-Daten), `E2E_SCREENSHOTS=skip` alles andere. Ohne die Variable (gezielter Aufruf `npx playwright test <Datei>`) läuft alles wie angegeben.
 */
const screenshotMode = process.env.E2E_SCREENSHOTS === "only" || process.env.E2E_SCREENSHOTS === "skip" ? process.env.E2E_SCREENSHOTS : null;

export default defineConfig({
  testDir: "./e2e/tests",
  ...(screenshotMode === "only" ? { testMatch: "**/screenshots.spec.ts" } : screenshotMode === "skip" ? { testIgnore: "**/screenshots.spec.ts" } : {}),
  // Je Lauf eigene Ordner (Playwright leert sie beim Start; sonst überschriebe der zweite Lauf die Fehlerspuren des ersten)
  outputDir: screenshotMode ? `test-results/${screenshotMode}` : "test-results",
  timeout: 120_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  fullyParallel: true,
  // 1 500 Tests in vier Größen: lokal sechs Worker (rund 10 Minuten), in der Pipeline drei (GitHub-Runner haben vier Kerne)
  workers: 3,
  // Ein Wiederholungsversuch fängt in der Pipeline einen Ausreißer ab, aber ein Test, der erst beim zweiten Mal besteht, ist „flaky“ – das färbt den Lauf rot (Z6-4 M-5) und wird nicht stillschweigend grün.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: screenshotMode ? `playwright-report/${screenshotMode}` : "playwright-report" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  // Baseline-Screenshots: ein Ordner je Projekt, unabhängig vom Betriebssystem (nur auf Linux verbindlich, siehe e2e/tests/screenshots.spec.ts)
  snapshotPathTemplate: "{testDir}/../snapshots/{projectName}/{arg}{ext}",
  updateSnapshots: process.env.E2E_UPDATE_SNAPSHOTS === "1" ? "all" : "none",
  webServer: {
    command: "node e2e/start-server.mjs",
    url: `${BASE_URL}/api/health`,
    // E2E_REUSE=1 (nur beim Entwickeln von Tests): ein schon laufender Server samt eingerichteten Konten (e2e/.auth) wird weiterverwendet, statt alles frisch aufzusetzen
    reuseExistingServer: process.env.E2E_REUSE === "1",
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  use: {
    baseURL: BASE_URL,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    storageState: authFile("admin"),
    // Der Service Worker (P3-5) ist nur in e2e/tests/pwa.spec.ts aktiv; sonst verfälschte sein Zwischenspeicher Messungen (Netz, Baselines, Screenshots)
    serviceWorkers: "block",
    // Eine Aktion, die nie möglich wird, soll nach Sekunden scheitern – nicht erst am Zeitlimit des ganzen Tests
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "iphone", use: { ...iphone, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: "tablet-hoch", use: { ...chromium, viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, launchOptions: { args: TEXT_ARGS } } },
    { name: "tablet-quer", use: { ...chromium, viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true, launchOptions: { args: TEXT_ARGS } } },
    { name: "desktop", use: { ...chromium, viewport: { width: 1440, height: 900 } } },
  ],
});
