import { expect, test, type Page } from "@playwright/test";
import { cspViolations, watchCsp } from "../support/checks";
import { createAppointment, createCustomerWithVehicle, save, uniqueName } from "../support/flow";
import { collectBrowserErrors } from "../support/page-checks";

/**
 * Weitere Durchläufe der Browser-CI (Z6-4 M-4, 13f): Termin → Aktionen im Bearbeiten-Dialog (Z6-5 H1) und Fokus nach dem Schließen (M2), Lager (Wareneingang, Inventur – auch am
 * 390-px-Projekt), Berichte (Diagramm am Handy lesbar, Tabellen-Alternative, CSV), Fuhrpark, Benutzer und Rollen (anlegen, ändern, deaktivieren, löschen).
 * Jeder Durchlauf legt seine eigenen Datensätze an (eindeutige Namen je Projekt), damit parallele Projekte einander nicht stören.
 */

const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("Termin antippen: der Bearbeiten-Dialog bietet „Auftrag aus Termin“ und „Terminzettel“; Escape bringt den Fokus auf die Seite zurück", async ({ page }, info) => {
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  const { lastName, vehicleId } = await createCustomerWithVehicle(page, info);
  const appointment = await createAppointment(page, vehicleId, `Zettel ${lastName}`);

  // Ein Tipp auf den Termin öffnet für Bearbeiter das Formular – die Aktionen der Leseansicht müssen dort erreichbar sein (H1)
  await page.goto("/appointments?view=list");
  await page.locator("a[href*='edit=']").filter({ hasText: appointment.title }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Termin bearbeiten" })).toBeVisible();
  const actions = dialog.getByRole("group", { name: "Aktionen zum Termin" });
  await expect(actions.getByRole("link", { name: "Terminzettel" })).toHaveAttribute("href", `/appointments/${appointment.id}/slip`);
  await expect(actions.getByRole("link", { name: "Auftrag aus Termin" })).toBeVisible();

  // Escape: der Dialog geht zu, der Fokus liegt nie auf <body> (M2) – hier am Link des Termins
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName ?? "BODY")).not.toBe("BODY");

  await page.locator("a[href*='edit=']").filter({ hasText: appointment.title }).first().click();
  await page.getByRole("dialog").getByRole("link", { name: "Auftrag aus Termin" }).click();
  await page.waitForURL(/\/orders\/new\?appointment=/);
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});

test("Lager: Artikel anlegen, Wareneingang buchen, Inventur mit Korrektur (auch am Handy ohne Überbreite)", async ({ page }, info) => {
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  // beginnt mit „A00“: Die Inventur sortiert nach Nummer und zeigt nur die ersten Artikel
  const number = `A00-E2E-${info.project.name}-${Date.now().toString(36)}`.toUpperCase();
  await page.goto("/parts/new");
  await page.locator("#number").fill(number);
  await page.locator("#name").fill(`Ölfilter ${info.project.name}`);
  await page.locator("#unit").fill("Stk");
  await save(page);
  await page.waitForURL((url) => /^\/parts\/(?!new$)[^/]+$/.test(url.pathname));
  const articleId = new URL(page.url()).pathname.split("/").pop()!;

  // Wareneingang mit Nummer des Lieferscheins
  await page.goto(`/parts/receipt?article=${articleId}`);
  await page.locator("#quantity").fill("12");
  await page.locator("#reference").fill("LS-E2E-1");
  await page.getByRole("button", { name: "Wareneingang buchen", exact: true }).click();
  // erst die Meldung abwarten: ein Seitenwechsel mitten in der Aktion bricht sie ab (WebKit meldet dann „Load failed“)
  await expect(page.locator("[data-flash]").first()).toBeVisible();
  await page.goto(`/parts/${articleId}`);
  await expect(page.getByText("12 Stk").first()).toBeVisible();
  // (Tabelle am Rechner, Karten am Handy: nur der sichtbare Eintrag zählt)
  await expect(page.locator(":text-is('Wareneingang'):visible").first()).toBeVisible();

  // Inventur: gezählt 10 statt 12 → Korrektur −2, der Bestand folgt
  await page.goto("/parts/count");
  const row = page.locator("[data-count-row]").filter({ hasText: number });
  await expect(row).toBeVisible();
  await row.getByLabel("Gezählt").fill("10");
  expect(await noHorizontalOverflow(page), "die Inventur hat keine Überbreite").toBe(true);
  await page.getByRole("button", { name: "Inventur buchen", exact: true }).click();
  await expect(page.locator("[data-flash]").first()).toBeVisible();
  await page.goto(`/parts/${articleId}`);
  await expect(page.getByText("10 Stk").first()).toBeVisible();
  await expect(page.locator(":text-is('Korrektur (Inventur)'):visible").first()).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});

test("Berichte: Umsatz je Monat mit lesbarer Schrift, Tabellen-Alternative und CSV-Export", async ({ page }, info) => {
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Berichte" })).toBeVisible();
  await page.goto("/reports/revenue");
  await expect(page.getByRole("heading", { level: 1, name: "Umsatz je Monat" })).toBeVisible();
  expect(await noHorizontalOverflow(page), "keine Überbreite").toBe(true);

  // Diagramm: die Beschriftung ist in Bildschirmpixeln etwa 12 px groß (Maßstab des viewBox ≈ 1), auch am Handy (Z6-5 M4)
  const svg = page.locator("figure svg[role='img']").first();
  await expect(svg).toBeVisible();
  // (erst nach der Hydration: Bis dahin gilt die Breite 640 des Servers)
  await expect
    .poll(
      () =>
        svg.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const viewBox = (element as SVGSVGElement).viewBox.baseVal;
          return box.width / viewBox.width;
        }),
      { message: `Maßstab des Diagramms (${info.project.name})` },
    )
    .toBeGreaterThan(0.9);
  const fontPx = await svg.locator("text").first().evaluate((text) => text.getBoundingClientRect().height);
  expect(fontPx, "Beschriftung lesbar groß").toBeGreaterThan(9);

  // Tabellen-Alternative erreichbar und zurück
  await page.getByRole("button", { name: "Als Tabelle" }).click();
  await expect(page.locator("figure table")).toBeVisible();
  await page.getByRole("button", { name: "Als Diagramm" }).click();
  await expect(svg).toBeVisible();

  // CSV-Export: Datei mit Kopfzeile, ohne Fehlermeldung
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV-Datei herunterladen" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/i);
  expect(browserErrors()).toEqual([]);
  expect(await cspViolations(page)).toEqual([]);
});

test("Fuhrpark: Fahrzeug anlegen, Kilometerstand erfassen, Fahrzeug in der Liste", async ({ page }, info) => {
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  const plate = `B-FL ${Math.floor(1000 + Math.random() * 8999)}`;
  await page.goto("/fleet/new");
  await page.locator("#plate").fill(plate);
  await page.locator("#make").fill("Mercedes");
  await page.locator("#model").fill(`Sprinter ${info.project.name}`);
  await page.locator("#year").fill("2022");
  await save(page);
  await page.waitForURL((url) => /^\/fleet\/(?!new$|licenses$)[^/]+$/.test(url.pathname));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(plate);

  // Kilometerstand erfassen
  // (das Formular der Kosten hat ebenfalls ein Feld „km“, aber ohne Pflicht)
  const form = page.locator("form").filter({ has: page.locator("input[name='km'][required]") });
  await form.locator("input[name='km']").fill("45000");
  await form.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByText(/45\.000 km/).first()).toBeVisible();

  // in der Liste
  await page.goto("/fleet");
  await expect(page.locator(".plate:visible", { hasText: plate }).first()).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});

test("Benutzer und Rollen: Rolle anlegen, Benutzer anlegen, Anzeigename ändern, deaktivieren; ungenutzte Rolle löschen", async ({ page }, info) => {
  test.skip(!["desktop", "iphone"].includes(info.project.name), "ein Durchlauf auf Handy und Desktop genügt");
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  const roleName = uniqueName(info, "Rolle");
  const spareRole = uniqueName(info, "Reserve");
  const username = uniqueName(info, "benutzer").toLowerCase();
  const displayName = `Test ${username}`;

  // Rolle aus der Vorlage „Mechaniker“ (Masken-Details prüft ein eigener Durchlauf), und eine zweite, die wieder gelöscht wird
  for (const name of [roleName, spareRole]) {
    await page.goto("/admin/roles/new");
    await page.waitForLoadState("networkidle");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await page.getByRole("button", { name: "Mechaniker – Vorlage übernehmen" }).click();
    await save(page);
    await page.waitForURL((url) => url.pathname === "/admin/roles");
    await expect(page.getByText(name).first()).toBeVisible();
  }

  // Benutzer mit dieser Rolle
  await page.goto("/admin/users/new");
  await page.locator("#username").fill(username);
  await page.locator("#name").fill(displayName);
  await page.locator("#password").fill("E2e-Benutzer-Passwort-2026!");
  await page.getByRole("checkbox", { name: new RegExp(roleName) }).check();
  await save(page);
  await page.waitForURL((url) => url.pathname === "/admin/users");
  // Tabelle und Karten (Handy) stehen beide im Dokument: nur der sichtbare Link zählt
  const userLink = (text: string) => page.locator("a:visible", { hasText: text }).first();
  await expect(userLink(displayName)).toBeVisible();

  // Anzeigename ändern, dann deaktivieren (das Konto ist danach nicht mehr aktiv)
  await userLink(displayName).click();
  await page.waitForURL((url) => /^\/admin\/users\/(?!new$)[^/]+$/.test(url.pathname));
  const editUrl = page.url();
  await page.locator("#name").fill(`${displayName} geändert`);
  await save(page);
  await page.waitForURL((url) => url.pathname === "/admin/users");
  await expect(userLink(`${displayName} geändert`)).toBeVisible();
  await page.goto(editUrl);
  await page.getByRole("checkbox", { name: "Konto ist aktiv" }).uncheck();
  await save(page);
  await page.waitForURL((url) => url.pathname === "/admin/users");
  await page.goto(editUrl);
  await expect(page.getByRole("checkbox", { name: "Konto ist aktiv" })).not.toBeChecked();

  // ungenutzte Rolle löschen: Rückfrage bestätigen, danach ist sie weg
  await page.goto("/admin/roles");
  await page.locator("a:visible", { hasText: spareRole }).first().click();
  await page.waitForURL((url) => /^\/admin\/roles\/(?!new$)[^/]+$/.test(url.pathname));
  await page.getByRole("button", { name: "Rolle löschen" }).click();
  await page.getByRole("dialog", { name: "Rolle löschen?" }).getByRole("button", { name: "Rolle löschen" }).click();
  await page.waitForURL((url) => url.pathname === "/admin/roles");
  await expect(page.locator("a:visible", { hasText: spareRole })).toHaveCount(0);
  await expect(page.locator("a:visible", { hasText: roleName }).first()).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});
