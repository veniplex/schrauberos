import { expect, test, type Page } from "@playwright/test";
import { createCustomerWithVehicle, fillStable, save } from "../support/flow";
import { cspViolations, settle, watchCsp } from "../support/checks";
import { collectBrowserErrors, runPageChecks } from "../support/page-checks";

/**
 * Am Tresen mit dem Handy und dem Tablet (iPhone/WebKit 390 px, Tablet hoch 820 px und quer 1180 px, Desktop): der Positionen-Editor eines Auftrags (Karten statt Tabelle, Summenleiste,
 * Touch-Ziele, Eingabeschrift, keine Überbreite – auch mit mehreren Positionen) und die Kundenfreigabe bei Mehrarbeit mit gezeichneter Unterschrift (Zeigerereignisse → PNG).
 */
async function newOrder(page: Page, info: Parameters<typeof createCustomerWithVehicle>[1]) {
  const customer = await createCustomerWithVehicle(page, info);
  await page.goto(`/orders/new?vehicle=${customer.vehicleId}`);
  await page.locator("#request").fill("Bremsen vorn prüfen");
  await save(page);
  await page.waitForURL((url) => /^\/orders\/(?!new$)[^/]+$/.test(url.pathname));
  return { ...customer, orderId: new URL(page.url()).pathname.split("/").pop()! };
}

test("Positionen-Editor: mehrere Positionen erfassen, Summen, speichern – ohne Überbreite, mit Touch-Zielen und lesbarer Schrift", async ({ page }, info) => {
  test.setTimeout(150_000);
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  const { orderId } = await newOrder(page, info);
  await page.goto(`/orders/${orderId}`);

  for (const [index, [text, price]] of [["Bremsscheiben vorn", "119,00"], ["Bremsbeläge vorn", "64,50"], ["Arbeitszeit", "85,00"]].entries()) {
    await page.getByRole("button", { name: "Position hinzufügen" }).click();
    const row = page.getByRole("group", { name: `Position ${index + 1}` });
    await row.getByRole("textbox", { name: "Beschreibung" }).fill(text);
    await row.getByLabel("Einzelpreis netto").fill(price);
  }
  // Summe: 119,00 + 64,50 + 85,00 = 268,50 netto
  await expect(page.getByText("268,50 €").first()).toBeVisible();
  await page.getByRole("button", { name: "Position 3 entfernen" }).click();
  await expect(page.getByText("183,50 €").first()).toBeVisible();
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  const third = page.getByRole("group", { name: "Position 3" });
  await third.getByRole("textbox", { name: "Beschreibung" }).fill("Bremsflüssigkeit wechseln");
  await third.getByLabel("Einzelpreis netto").fill("45,00");
  await settle(page);

  // Layout in dieser Größe: Überbreite, Touch-Ziele, Eingabeschrift, axe (hell und dunkel)
  await runPageChecks(page, info, "orders/[id] (Positionen-Editor mit Positionen)");

  await page.getByRole("button", { name: "Positionen speichern" }).click();
  await expect(page.locator("[data-flash]").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("group", { name: "Position 3" }).getByRole("textbox", { name: "Beschreibung" })).toHaveValue("Bremsflüssigkeit wechseln");
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});

test("Kundenfreigabe bei Mehrarbeit: Betrag, Person, Begründung und gezeichnete Unterschrift – protokolliert, die Unterschrift ist ein PNG", async ({ page, request }, info) => {
  test.setTimeout(150_000);
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  const { orderId } = await newOrder(page, info);
  await page.goto(`/orders/${orderId}`);
  await page.waitForLoadState("networkidle"); // erst nach der Hydration tippen (gesteuerte Felder, siehe fillStable)

  await fillStable(page.getByRole("textbox", { name: "Freigegebener Mehrbetrag (brutto)" }), "120,00");
  await page.getByRole("textbox", { name: "Freigebende Person" }).fill("Erika Mustermann");
  await page.getByRole("textbox", { name: "Begründung der Mehrarbeit" }).fill("Bremsleitungen sind korrodiert");
  const canvas = page.locator("canvas").first();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const jitter = () => (Math.random() - 0.5) * 0.08; // jede Unterschrift muss neu sein (die Anwendung weist eine wiederverwendete ab)
  const point = (x: number, y: number) => ({ x: box.x + box.width * (x + jitter()), y: box.y + box.height * (y + jitter()) });
  const start = point(0.15, 0.6);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const [x, y] of [[0.3, 0.25], [0.45, 0.7], [0.6, 0.3], [0.8, 0.6]] as const) await page.mouse.move(point(x, y).x, point(x, y).y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText("Unterschrift aufgenommen.")).toBeVisible();

  await page.getByRole("button", { name: "Freigabe protokollieren" }).click();
  await expect(page.getByText("Keine Freigabe erfasst.")).toHaveCount(0);
  const view = page.getByRole("link", { name: /Unterschrift ansehen/ }).first();
  await expect(view).toBeVisible();
  const response = await request.get((await view.getAttribute("href"))!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/png");
  expect((await response.body()).subarray(1, 4).toString("latin1")).toBe("PNG");
  await expect(page.getByText("erfasst von E2E Administrator")).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});
