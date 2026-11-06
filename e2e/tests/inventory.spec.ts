import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { checkAgainstBaseline } from "../support/baseline";
import { axeRules, cspViolations, findOverflow, findSmallInputFont, findSmallTargets, watchCsp } from "../support/checks";
import { loadInventory, type InventoryEntry } from "../support/inventory";

/**
 * Routen-Inventur (Liste, Detail, Neu, Bearbeiten, Dialoge … aller Funktionen, mit Seed-IDs): jede Seite wird als Administrator in allen
 * vier Anzeigegrößen geöffnet und geprüft auf
 *   - Überbreite (Elementrechte, nicht scrollWidth),
 *   - Touch-Ziele ≥ 44 px und Eingabeschrift ≥ 16 px (nur bei Touch),
 *   - axe-core in Hell und Dunkel,
 *   - Verstöße gegen die Content-Security-Policy (`securitypolicyviolation`),
 * mit Baseline-Listen bekannter Verstöße (e2e/baselines/known-violations.json), die mit jedem Paket schrumpfen.
 * Zugriff je Rolle: roles.spec.ts.
 */
const entries = loadInventory();

async function openAndCheck(page: Page, entry: InventoryEntry, info: TestInfo) {
  const touch = Boolean(info.project.use.hasTouch);
  await watchCsp(page);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const response = await page.goto(entry.url, { waitUntil: "load" });
  expect(response?.status(), `${entry.url}: Statuscode`).toBe(200);
  await expect(page.locator("[data-status='not-found']"), `${entry.url}: Seite nicht gefunden`).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  if (entry.kind === "modal") await expect(page.locator("dialog[open]")).toBeVisible();

  checkAgainstBaseline(info, "overflow", entry.key, await findOverflow(page));
  if (touch) {
    checkAgainstBaseline(info, "touch", entry.key, await findSmallTargets(page));
    checkAgainstBaseline(info, "font", entry.key, await findSmallInputFont(page));
  }
  checkAgainstBaseline(info, "axe-light", entry.key, await axeRules(page));
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  checkAgainstBaseline(info, "axe-dark", entry.key, await axeRules(page));
  expect.soft(await cspViolations(page), `${entry.key}: Verstöße gegen die Content-Security-Policy`).toEqual([]);
}

test.describe("Seiten als Administrator", () => {
  for (const entry of entries.filter((e) => !e.public)) {
    test(entry.key, async ({ page }, info) => {
      await openAndCheck(page, entry, info);
    });
  }
});

test.describe("Anmeldeseiten ohne Sitzung", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const entry of entries.filter((e) => e.public && e.key !== "/forbidden")) {
    test(entry.key, async ({ page }, info) => {
      await openAndCheck(page, entry, info);
    });
  }
});
