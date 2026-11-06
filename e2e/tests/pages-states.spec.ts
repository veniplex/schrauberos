import { expect, test } from "@playwright/test";

/** Fehler- und Ladeseiten: Unbekannte Adressen und gesperrte Seiten zeigen die Seite „nicht gefunden“ im Rahmen der Anwendung (mit Navigation). */
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

test("Wartezustand: der Auslöser eines Dialogs zeigt ein Lade-Symbol, dazu der Fortschrittsbalken", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Verhalten ist unabhängig von der Anzeigegröße");
  await page.goto("/appointments");
  // Der Dialog wird über die Adresse geöffnet (gleiche Seite, neue Daten): die Antwort wird künstlich verzögert, damit der Wartezustand sichtbar bleibt
  await page.route((url) => url.pathname === "/appointments" && url.searchParams.has("new"), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  const trigger = page.locator('a[href*="new=1"]').first();
  await trigger.click();
  await expect(page.locator(".nav-progress")).toBeVisible();
  await expect(trigger.locator("svg.animate-spin")).toBeVisible();
  await expect(page.locator("dialog[open]")).toBeVisible();
  await expect(page.locator(".nav-progress")).toHaveCount(0);
});
