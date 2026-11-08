import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

/**
 * Bausteine der Tresen-Durchläufe (e2e/tests/counter-*.spec.ts, workshop-*.spec.ts): Eingaben wie am Tresen über die Oberfläche. Jeder Durchlauf legt seine eigenen Datensätze an
 * (eindeutiger Name je Lauf und Anzeigegröße), damit parallele Projekte einander nicht stören.
 */

export const uniqueName = (info: TestInfo, prefix: string) => `${prefix}-${info.project.name}-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;

export const save = (page: Page) => page.getByRole("button", { name: "Speichern", exact: true }).click();

/** Kunde und Fahrzeug anlegen (über „Speichern und Fahrzeug anlegen“); liefert Name, Kennzeichen und die Fahrzeug-ID. */
export async function createCustomerWithVehicle(page: Page, info: TestInfo, options: { mileage?: string } = {}) {
  const lastName = uniqueName(info, "Kunde");
  const plate = `B-E ${Math.floor(1000 + Math.random() * 8999)}`;
  await page.goto("/customers/new");
  await page.locator("#firstName").fill("Erika");
  await page.locator("#lastName").fill(lastName);
  await page.locator("#email").fill("erika@example.org");
  await page.locator("#phone").fill("030 123456");
  await page.locator("#street").fill("Musterstraße 7");
  await page.locator("#zip").fill("10115");
  await page.locator("#city").fill("Berlin");
  await page.getByRole("button", { name: "Speichern und Fahrzeug anlegen" }).click();
  await page.waitForURL((url) => url.pathname === "/vehicles/new" && url.searchParams.has("customer"));
  await page.locator("#plate").fill(plate);
  await page.locator("#make").fill("VW");
  await page.locator("#model").fill("Golf VIII");
  if (options.mileage) await page.locator("#mileageKm").fill(options.mileage).catch(() => undefined);
  await save(page);
  await page.waitForURL((url) => /^\/vehicles\/(?!new$)[^/]+$/.test(url.pathname));
  const vehicleId = new URL(page.url()).pathname.split("/").pop()!;
  return { lastName, plate, vehicleId };
}

/** Termin für ein Fahrzeug im Dialog anlegen; liefert Titel und die Termin-ID (aus dem Link der Listenansicht). */
export async function createAppointment(page: Page, vehicleId: string, title: string) {
  await page.goto(`/appointments?new=1&vehicle=${vehicleId}`);
  await expect(page.locator("dialog[open]")).toBeVisible();
  await page.locator("#title").fill(title);
  await save(page);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.goto("/appointments?view=list");
  const link = page.locator("a[href*='edit=']").filter({ hasText: title }).first();
  await expect(link).toBeVisible();
  const id = new URL((await link.getAttribute("href"))!, page.url()).searchParams.get("edit")!;
  return { title, id };
}

/** Die Seite der Anwendung nach einem Wechsel: genau eine Hauptüberschrift, kein Fehlerzustand. */
export async function expectHeading(page: Page, text: string | RegExp) {
  await expect(page.getByRole("heading", { level: 1 })).toContainText(text);
  await expect(page.locator("[data-status='error']")).toHaveCount(0);
}

/**
 * Füllt ein Feld und prüft, dass der Wert stehen bleibt. Nötig bei **gesteuerten** Feldern (z. B. Geldbetrag) in WebKit: Tippt der Test, bevor React die Seite übernommen hat (Hydration),
 * setzt React das Feld auf den Anfangswert zurück – ein Mensch tippt nie so früh. Wiederholt, bis der Wert hält.
 */
export async function fillStable(locator: Locator, value: string) {
  await expect(async () => {
    await locator.fill(value);
    await expect(locator).toHaveValue(value, { timeout: 2_500 });
  }).toPass({ timeout: 20_000 });
}
