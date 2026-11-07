import { expect, test } from "@playwright/test";

/**
 * Tresen-Durchlauf als Smoke-Test: Kunde → Fahrzeug → Termin → Reifen, so wie am Tresen (Handy und Desktop). Bleibt dauerhaft in der CI;
 * ab dem Auftragsfluss kommt „Termin → Auftrag → Rechnung → Mail/Druck“ hinzu.
 */
test("Tresen: Kunde, Fahrzeug, Termin und Reifensatz anlegen", async ({ page }, info) => {
  test.skip(!["iphone", "desktop"].includes(info.project.name), "Durchlauf auf Handy und Desktop genügt");
  const unique = `${info.project.name}-${Date.now().toString(36)}`;
  const lastName = `Tresen-${unique}`;
  const plate = `B-T ${Math.floor(1000 + Math.random() * 8999)}`;
  const save = () => page.getByRole("button", { name: "Speichern", exact: true }).click();

  // 1. Kunde – „Speichern und Fahrzeug anlegen“ führt direkt zum Fahrzeugformular, der neue Kunde ist als Halter vorbelegt
  await page.goto("/customers/new");
  await page.locator("#firstName").fill("Erika");
  await page.locator("#lastName").fill(lastName);
  await page.locator("#phone").fill("030 123456");
  await page.getByRole("button", { name: "Speichern und Fahrzeug anlegen" }).click();
  await page.waitForURL((url) => url.pathname === "/vehicles/new" && url.searchParams.has("customer"));
  await expect(page.getByText(lastName).first()).toBeVisible();

  // 2. Fahrzeug
  await page.locator("#plate").fill(plate);
  await page.locator("#make").fill("VW");
  await page.locator("#model").fill("Golf VIII");
  await save();
  await page.waitForURL((url) => /^\/vehicles\/(?!new$)[^/]+$/.test(url.pathname));
  const vehicleId = page.url().split("/").pop()!;
  await expect(page.getByText(lastName).first()).toBeVisible();

  // 3. Termin für dieses Fahrzeug (Dialog)
  const title = `Reifenwechsel ${unique}`;
  await page.goto(`/appointments?new=1&vehicle=${vehicleId}`);
  await expect(page.locator("dialog[open]")).toBeVisible();
  await page.locator("#title").fill(title);
  await save();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.goto("/appointments?view=list");
  await expect(page.getByText(title).first()).toBeVisible();

  // 4. Reifensatz zum Fahrzeug
  await page.goto(`/tires/new?vehicle=${vehicleId}`);
  await page.locator("#brand").fill("Continental");
  await page.locator("#width").fill("205");
  await page.locator("#aspect").fill("55");
  await page.locator("#rim").fill("16");
  await save();
  await page.waitForURL((url) => /^\/tires\/(?!new$)[^/]+$/.test(url.pathname));
  await expect(page.getByText("Continental").first()).toBeVisible();
});
