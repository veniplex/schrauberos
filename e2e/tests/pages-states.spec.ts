import { expect, test } from "@playwright/test";

/** Fehler- und Ladeseiten: Unbekannte Adressen und gesperrte Seiten zeigen die Seite „nicht gefunden“ im Rahmen der Anwendung (mit Navigation). Fehlerzustände: states.spec.ts. */
test("unbekannte Adresse: Seite nicht gefunden mit Navigation und Link zur Übersicht", async ({ page }) => {
  await page.goto("/gibt-es-nicht");
  const notFound = page.locator("[data-status='not-found']");
  await expect(notFound).toBeVisible();
  await expect(notFound.getByRole("heading", { level: 1 })).toHaveText("Seite nicht gefunden");
  await expect(page.getByRole("link", { name: "Zur Übersicht" })).toBeVisible();
  // Angemeldet: der Anwendungsrahmen ist da (Haupt-Navigation im Dokument)
  await expect(page.locator("nav[aria-label]").first()).toBeAttached();
});

test("nicht vorhandener Datensatz: Seite nicht gefunden innerhalb der Anwendung", async ({ page }) => {
  await page.goto("/customers/gibt-es-nicht");
  await expect(page.locator("[data-status='not-found']")).toBeVisible();
  await expect(page.locator("nav[aria-label]").first()).toBeAttached();
});

test("Wartezustand: der Auslöser eines Dialogs zeigt ein Lade-Symbol ohne Layout-Sprung, dazu Fortschrittsbalken und Ansage für Screenreader", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Verhalten ist unabhängig von der Anzeigegröße");
  await page.goto("/appointments");
  // Der Dialog wird über die Adresse geöffnet (gleiche Seite, neue Daten): die Antwort wird künstlich verzögert, damit der Wartezustand sichtbar bleibt
  await page.route((url) => url.pathname === "/appointments" && url.searchParams.has("new"), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  // Nur ein sichtbarer Auslöser zählt (ein Link im geschlossenen Menü hat keine Fläche, `boundingBox()` wäre `null`); gemessen wird mit `getBoundingClientRect` im Seitenkontext, das auch dann
  // eine Antwort gibt, wenn der Link beim Messen gerade ersetzt wird (langsame Läufe im Container: der Dialog kann schon offen sein)
  const trigger = page.locator('a[href*="new=1"]:visible').first();
  await expect(trigger).toBeVisible();
  const size = () => trigger.evaluate((el) => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
  // die Ansage der Navigation (die Schnellsuche und das Seitenfach haben eigene Regionen ohne `no-print`)
  const live = page.locator("div[role='status'].sr-only.no-print");
  await expect(live, "die Live-Region ist schon vor dem Laden da und leer").toHaveText("");
  const idle = await size();
  expect(idle.width, "der Auslöser hat vor dem Klick eine Fläche").toBeGreaterThan(0);
  await trigger.click();
  await expect(page.locator(".nav-progress")).toBeVisible();
  await expect(trigger.locator("svg.animate-spin")).toBeVisible();
  await expect(live).toHaveText(/Wird geladen/);
  const pending = await size();
  expect(pending.width, "Breite des Auslösers ändert sich beim Warten nicht").toBeCloseTo(idle.width, 0);
  expect(pending.height, "Höhe des Auslösers ändert sich beim Warten nicht").toBeCloseTo(idle.height, 0);
  await expect(page.locator("dialog[open]")).toBeVisible();
  await expect(page.locator(".nav-progress")).toHaveCount(0);
  await expect(live).toHaveText("");
});

test("weniger Bewegung: Endlos-Animationen laufen nicht (Spinner, Fortschrittsbalken), das Skelett nur einmal", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Verhalten ist unabhängig von der Anzeigegröße");
  await page.goto("/help");
  const measure = () =>
    page.evaluate(() => {
      const add = (className: string) => {
        const el = document.createElement("div");
        el.className = className;
        document.body.append(el);
        return el;
      };
      const spinner = add("animate-spin");
      const bar = add("nav-progress");
      const pulse = add("animate-pulse");
      const result = {
        spinner: getComputedStyle(spinner).animationName,
        bar: getComputedStyle(bar, "::before").animationName,
        pulseIterations: getComputedStyle(pulse).animationIterationCount,
      };
      for (const el of [spinner, bar, pulse]) el.remove();
      return result;
    });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await measure()).toEqual({ spinner: "none", bar: "none", pulseIterations: "1" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const normal = await measure();
  expect(normal.spinner).toBe("spin");
  expect(normal.bar).toBe("nav-progress");
});
