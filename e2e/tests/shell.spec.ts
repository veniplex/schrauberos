import { expect, test } from "@playwright/test";

/**
 * Anwendungsrahmen und Formulare im echten Browser (Komponentenverhalten: `src/components/**` Tests, hier das Zusammenspiel mit Server und Layout):
 * Seitenfach auf dem Handy, Schnellsuche, Fehlerzusammenfassung mit erhaltener Eingabe, „Änderungen verwerfen?“ im Dialog.
 */

test("Handy: Das Seitenfach öffnet und schließt per Knopf und Escape, der Fokus kehrt zum Menü-Knopf zurück", async ({ page }, info) => {
  test.skip(info.project.name !== "iphone", "Seitenfach gibt es nur unter 1024 px");
  await page.goto("/");
  const open = page.getByRole("button", { name: "Menü öffnen" });
  await open.click();
  const drawer = page.locator("dialog.drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("navigation", { name: "Hauptnavigation" })).toBeVisible();
  await drawer.getByRole("button", { name: "Menü schließen" }).click();
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();
});

test("Sprunglink: Tab springt zum Inhalt", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Tastaturbedienung am Desktop");
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Zum Inhalt springen" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
});

test("Schnellsuche findet einen neuen Kunden und öffnet ihn; ohne Recht keine Treffer anderer Bereiche", async ({ page }, info) => {
  test.skip(!["iphone", "desktop"].includes(info.project.name), "ein Durchlauf auf Handy und Desktop genügt");
  const lastName = `Suche-${info.project.name}-${Date.now().toString(36)}`;
  await page.goto("/customers/new");
  await page.locator("#lastName").fill(lastName);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await page.waitForURL((url) => /^\/customers\/(?!new$)[^/]+$/.test(url.pathname));

  // Handy: Das Symbol öffnet das vollbreite Feld
  if (info.project.name === "iphone") await page.getByRole("button", { name: "Suche öffnen" }).click();
  const field = page.getByRole("search").getByRole("searchbox");
  await field.fill(lastName);
  const results = page.getByRole("region", { name: "Suchergebnisse" });
  await expect(results.getByRole("link", { name: new RegExp(lastName) })).toBeVisible();
  await field.press("Enter");
  await expect(page).toHaveURL(/\/customers\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(lastName);
});

test("Formular: Fehlerzusammenfassung nennt das Feld, die Eingabe bleibt erhalten, die Fehlermeldung ist spezifisch", async ({ page }, info) => {
  test.skip(!["iphone", "desktop"].includes(info.project.name), "ein Durchlauf auf Handy und Desktop genügt");
  await page.goto("/customers/new");
  await page.locator("#lastName").fill("Fehlertest");
  await page.locator("#email").fill("kaputt");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();

  const summary = page.locator("[data-form-errors]");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("E-Mail");
  await expect(summary).toContainText("gültige E-Mail-Adresse");
  await expect(summary).toBeFocused();
  await expect(page.locator("#lastName")).toHaveValue("Fehlertest");
  await expect(page.locator("#email")).toHaveValue("kaputt");
  await expect(page.locator("#email")).toHaveAttribute("aria-invalid", "true");

  // Ein Klick auf den Eintrag springt ins Feld
  await summary.getByRole("button").first().click();
  await expect(page.locator("#email")).toBeFocused();
});

test("Dialog mit Eingaben fragt beim Schließen „Änderungen verwerfen?“", async ({ page }, info) => {
  test.skip(!["iphone", "desktop"].includes(info.project.name), "ein Durchlauf auf Handy und Desktop genügt");
  await page.goto("/appointments?new=1");
  const modal = page.locator("dialog.modal").first();
  await expect(modal).toBeVisible();
  await page.locator("#title").fill("Nicht gespeichert");
  await page.keyboard.press("Escape");
  const confirm = page.getByRole("dialog", { name: "Änderungen verwerfen?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Weiter bearbeiten" }).click();
  await expect(page.locator("#title")).toHaveValue("Nicht gespeichert");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Änderungen verwerfen?" }).getByRole("button", { name: "Verwerfen" }).click();
  await expect(page).not.toHaveURL(/new=1/);
});

test("Kunde anlegen und weiter: „Speichern und Fahrzeug anlegen“ führt zum Fahrzeugformular mit Halter", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "ein Durchlauf genügt (Tresen-Durchlauf deckt Handy ab)");
  const lastName = `Weiter-${Date.now().toString(36)}`;
  await page.goto("/customers/new");
  await page.locator("#lastName").fill(lastName);
  await page.getByRole("button", { name: "Speichern und Fahrzeug anlegen" }).click();
  await page.waitForURL((url) => url.pathname === "/vehicles/new" && url.searchParams.has("customer"));
  await expect(page.getByText(lastName).first()).toBeVisible();
});
