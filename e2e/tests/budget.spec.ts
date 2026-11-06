import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASELINE_DIR, FOUND_DIR, UPDATE_BASELINE, authFile } from "../support/env";
import { loadInventory } from "../support/inventory";
import { assertNoErrorPage, collectBrowserErrors } from "../support/page-checks";

/**
 * JS-Budget je Route: Summe des geladenen JavaScripts (entpackt, KB) beim ersten Aufruf mit leerem Cache. Die Zahlen stehen in
 * e2e/baselines/js-budget.json (Messung + 10 % Luft, auf 5 KB gerundet) und werden mit `E2E_UPDATE_BASELINE=1 npm run e2e` nach einer
 * bewussten Änderung neu festgeschrieben. Überschreitung = Abbruch der CI. Nur im Desktop-Projekt (unabhängig von der Anzeigegröße).
 */
const BUDGET_FILE = path.join(BASELINE_DIR, "js-budget.json");
const budget = (() => {
  try {
    return JSON.parse(readFileSync(BUDGET_FILE, "utf8")) as Record<string, number>;
  } catch {
    return {} as Record<string, number>;
  }
})();

// Eine Seite je Routenmuster (die erste Variante ohne Suchparameter)
const routes = new Map<string, string>();
for (const entry of loadInventory().filter((e) => !e.public && !e.key.includes("?"))) if (!routes.has(entry.key)) routes.set(entry.key, entry.url);

for (const [route, url] of routes) {
  test(`JS-Budget ${route}`, async ({ browser }, info) => {
    test.skip(info.project.name !== "desktop", "Das Budget gilt je Route, nicht je Anzeigegröße");
    const context = await browser.newContext({ storageState: authFile("admin"), locale: "de-DE" });
    const page = await context.newPage();
    const browserErrors = collectBrowserErrors(page);
    const sizes: Promise<number>[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "script") sizes.push(response.body().then((b) => b.length).catch(() => 0));
    });
    try {
      const response = await page.goto(url, { waitUntil: "load" });
      expect(response?.status()).toBe(200);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      // Eine Fehlerseite lädt wenig JavaScript und bliebe sonst „im Budget“
      await assertNoErrorPage(page, route);
      expect(browserErrors(), `${route}: Fehler im Browser`).toEqual([]);
      const kb = Math.round((await Promise.all(sizes)).reduce((a, b) => a + b, 0) / 1024);
      if (UPDATE_BASELINE) {
        mkdirSync(FOUND_DIR, { recursive: true });
        writeFileSync(path.join(FOUND_DIR, `js__${Buffer.from(route).toString("base64url")}.json`), JSON.stringify({ route, kb }));
        return;
      }
      const limit = budget[route];
      expect(limit, `${route}: kein JS-Budget festgeschrieben (E2E_UPDATE_BASELINE=1 npm run e2e)`).toBeDefined();
      expect(kb, `${route}: ${kb} KB JavaScript, Budget ${limit} KB`).toBeLessThanOrEqual(limit);
    } finally {
      await context.close();
    }
  });
}
