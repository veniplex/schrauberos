import { expect, test } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { UPDATE_SNAPSHOTS } from "../support/env";
import { loadInventory } from "../support/inventory";

/**
 * Baseline-Screenshots für eine feste Auswahl Schlüsselseiten (`key: true` in der pages.ts der Funktion) × Anzeigegröße × Hell/Dunkel.
 * Verbindlich nur auf Linux (Schriften und Rendering unterscheiden sich je System): Dort liegen die Baselines unter e2e/snapshots/<projekt>/.
 * Aktualisieren: Workflow „Build & publish“ von Hand mit „update_snapshots“ starten (oder lokal in Linux/Docker `E2E_UPDATE_SNAPSHOTS=1 npm run e2e`),
 * das Ergebnis kommt als Artefakt und wird in einem eigenen Commit mit dem Titel „snapshots“ eingecheckt. Ohne Baselines (oder auf anderen
 * Systemen) werden die Tests übersprungen – das Fehlen ist bewusst kein Fehlschlag, bis die ersten Baselines eingecheckt sind.
 */
const SNAPSHOTS = path.join(process.cwd(), "e2e", "snapshots");
const slug = (key: string) => key.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "start";

for (const entry of loadInventory().filter((e) => e.screenshot)) {
  for (const theme of ["light", "dark"] as const) {
    test(`Screenshot ${entry.key} (${theme})`, async ({ page }, info) => {
      const dir = path.join(SNAPSHOTS, info.project.name);
      const hasBaselines = existsSync(dir) && readdirSync(dir).length > 0;
      test.skip(!UPDATE_SNAPSHOTS && (process.platform !== "linux" || !hasBaselines), "Baseline-Screenshots gelten nur auf Linux und sobald sie eingecheckt sind");
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.goto(entry.url, { waitUntil: "load" });
      // Abwarten, bis die Seite fertig ist: Weiterleitungen (`/login` mit Anmeldung → Übersicht) und Daten, die nachgeladen werden, verändern sonst das Bild oder zerstören den Ausführungskontext
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      // Veränderliches (Datum, Uhrzeit, Zähler) wird abgedeckt
      await expect(page).toHaveScreenshot(`${slug(entry.key)}-${theme}.png`, { mask: [page.locator("time, header p, [data-e2e-mask]")], animations: "disabled", caret: "hide", scale: "css" });
    });
  }
}
