import { test, type Page, type TestInfo } from "@playwright/test";
import { openAndCheck as checkPage } from "../support/page-checks";
import { loadInventory, type InventoryEntry } from "../support/inventory";

/**
 * Routen-Inventur (Liste, Detail, Neu, Bearbeiten, Dialoge … aller Funktionen, mit Seed-IDs): jede Seite wird als Administrator in allen
 * vier Anzeigegrößen geöffnet und geprüft auf
 *   - Überbreite (Elementrechte, nicht scrollWidth),
 *   - Touch-Ziele ≥ 44 px und Eingabeschrift ≥ 16 px (nur bei Touch),
 *   - axe-core in Hell und Dunkel,
 *   - Verstöße gegen die Content-Security-Policy (`securitypolicyviolation`; die CSP wird erzwungen, Selbsttest und Header-Prüfung: states.spec.ts),
 *   - Fehlerseiten (`data-status="error"`) und Fehler des Browsers (`pageerror`, `console.error`),
 * mit Baseline-Listen bekannter Verstöße (e2e/baselines/known-violations.json), die mit jedem Paket schrumpfen.
 * Zugriff je Rolle: roles.spec.ts.
 */
const entries = loadInventory();

const openAndCheck = (page: Page, entry: InventoryEntry, info: TestInfo) => checkPage(page, entry.url, info, { key: entry.key, modal: entry.kind === "modal" });

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
