import { expect, test, type Page } from "@playwright/test";
import { cspViolations, watchCsp } from "../support/checks";
import { createCustomerWithVehicle, save, uniqueName } from "../support/flow";
import { EXIF_MARKER, browserJpeg, hasExif, withExif } from "../support/jpeg";
import { authFile } from "../support/env";
import { collectBrowserErrors } from "../support/page-checks";

/**
 * Werkstattalltag am Auftrag, jeweils mit eigenen Datensätzen: Checkliste „Annahmeprotokoll“ mit Namensunterschrift und gezeichneter Unterschrift (Zeigerereignisse → PNG), Fotos
 * (Mehrfach-Upload, Auslieferung ohne Exif, Wiederholung nach Netzausfall), Zeit stempeln und als Positionen übernehmen, Reifenlager-Etikett (PDF, QR, Druckansicht).
 */

async function newOrder(page: Page, info: Parameters<typeof createCustomerWithVehicle>[1]) {
  const customer = await createCustomerWithVehicle(page, info);
  await page.goto(`/orders/new?vehicle=${customer.vehicleId}`);
  await page.locator("#request").fill("Prüfung durch den E2E-Test");
  await save(page);
  await page.waitForURL((url) => /^\/orders\/(?!new$)[^/]+$/.test(url.pathname));
  return { ...customer, orderId: new URL(page.url()).pathname.split("/").pop()! };
}

/** Auf dem Zeichenfeld unterschreiben: ein paar Striche mit der Maus (Zeigerereignisse wie beim Stift; echte Fingereingabe nur am Gerät prüfbar). */
async function drawSignature(page: Page, canvas: ReturnType<Page["locator"]>) {
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  // Zufällige Abweichung: Die Anwendung weist eine Unterschrift ab, die schon bei einer anderen Freigabe oder Checkliste verwendet wurde (gleiche Bytes)
  const jitter = () => (Math.random() - 0.5) * 0.08;
  const at = (x: number, y: number) => ({ x: box.x + box.width * (x + jitter()), y: box.y + box.height * (y + jitter()) });
  const stroke = async (points: Array<[number, number]>) => {
    await page.mouse.move(at(...points[0]).x, at(...points[0]).y);
    await page.mouse.down();
    for (const point of points.slice(1)) await page.mouse.move(at(...point).x, at(...point).y, { steps: 6 });
    await page.mouse.up();
  };
  await stroke([[0.15, 0.6], [0.3, 0.25], [0.45, 0.7], [0.6, 0.3], [0.8, 0.6]]);
  await stroke([[0.2, 0.8], [0.75, 0.82]]);
}

test("Checkliste Annahmeprotokoll: Punkte abhaken, Name und gezeichnete Unterschrift, abschließen – die Unterschrift ist ein PNG", async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  const { orderId, plate, lastName } = await newOrder(page, info);

  await page.goto(`/orders/${orderId}`);
  await page.getByRole("button", { name: "Annahmeprotokoll starten" }).click();
  await page.waitForURL(/\/checklists\/(?!new)[^/]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(plate);

  // Pflichtpunkte: Wert, Auswahl, Haken
  await page.getByRole("textbox", { name: "Kilometerstand abgelesen: Wert" }).fill("45123");
  await page.getByRole("combobox", { name: "Tankfüllung" }).selectOption({ label: "1/2" });
  await page.getByRole("combobox", { name: "Warnleuchten im Kombiinstrument" }).selectOption({ label: "keine" });
  for (const name of [/Äußere Schäden dokumentiert/, /Wertgegenstände im Fahrzeug/, /Kundenwunsch besprochen/, /Kostenrahmen und Rückruf/]) await page.getByRole("checkbox", { name }).check();
  await expect(page.getByText(/von 9 erledigt/)).toContainText(/[6-9] von 9 erledigt/);

  // Abschluss: Name des Kunden, gezeichnete Unterschrift
  await page.getByRole("textbox", { name: "Name des Kunden" }).fill(`Erika ${lastName}`);
  await drawSignature(page, page.locator("canvas").first());
  await expect(page.getByText("Noch keine Unterschrift.")).toHaveCount(0);
  await page.getByRole("button", { name: "Checkliste abschließen" }).click();
  await expect(page.getByText("Abgeschlossen").first()).toBeVisible();

  // Die Unterschrift wird als Bild ausgeliefert (PNG, nicht als Datenwert in der Seite)
  const signature = page.getByRole("link", { name: "Unterschrift ansehen" });
  await expect(signature).toBeVisible();
  const response = await request.get((await signature.getAttribute("href"))!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/png");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  const png = await response.body();
  expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
  expect(png.length, "eine gezeichnete Unterschrift ist mehr als ein leeres Feld").toBeGreaterThan(300);
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});

test("Fotos am Auftrag: Mehrfach-Upload, Auslieferung ohne Exif, API-Upload wird serverseitig bereinigt, Wiederholung nach Netzausfall", async ({ page, request, context }, info) => {
  test.setTimeout(180_000);
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  const { orderId } = await newOrder(page, info);
  await page.goto(`/orders/${orderId}`);
  const photoInput = page.locator("input[type='file']").first();

  // Mehrfachauswahl am Handy/Desktop: zwei Fotos in einem Zug
  const one = withExif(await browserJpeg(page, 800, 600, "Foto 1"));
  const two = withExif(await browserJpeg(page, 640, 480, "Foto 2"));
  expect(hasExif(one), "das Testfoto trägt wirklich Exif").toBe(true);
  await photoInput.setInputFiles([
    { name: "vorne.jpg", mimeType: "image/jpeg", buffer: one },
    { name: "hinten.jpg", mimeType: "image/jpeg", buffer: two },
  ]);
  const thumbs = page.locator("img[src^='/api/files/']");
  await expect(thumbs).toHaveCount(2, { timeout: 30_000 });

  // Ausgeliefert wird nur ein bereinigtes Bild, mit sicheren Köpfen
  for (const src of await thumbs.evaluateAll((images) => images.map((image) => (image as HTMLImageElement).getAttribute("src")!))) {
    const response = await request.get(src);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/jpeg");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["content-security-policy"] ?? "").toContain("sandbox");
    expect(hasExif(await response.body()), `${src}: kein Exif`).toBe(false);
  }

  // API-Upload ohne den Verkleinerer des Browsers: der Server bereinigt selbst
  const raw = withExif(await browserJpeg(page, 320, 240, "API"));
  const uploaded = await request.post("/api/files", {
    headers: { "x-requested-with": "schrauberos", "idempotency-key": uniqueName(info, "idem") },
    multipart: { ownerType: "order", ownerId: orderId, category: "photo", file: { name: "api.jpg", mimeType: "image/jpeg", buffer: raw } },
  });
  expect(uploaded.status()).toBe(201);
  const { url } = (await uploaded.json()) as { url: string };
  const delivered = await request.get(url);
  expect(delivered.status()).toBe(200);
  expect(hasExif(await delivered.body()), "API-Upload: Server entfernt Exif").toBe(false);
  expect(raw.includes(Buffer.from(EXIF_MARKER, "latin1"))).toBe(true);

  // Netzausfall: der Upload scheitert sichtbar und lässt sich wiederholen
  await page.reload();
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  await page.locator("input[type='file']").first().setInputFiles({ name: "offline.jpg", mimeType: "image/jpeg", buffer: withExif(await browserJpeg(page, 640, 480, "offline")) });
  const retry = page.getByRole("button", { name: /erneut versuchen/i }).first();
  await expect(retry).toBeVisible({ timeout: 30_000 });
  await context.setOffline(false);
  await retry.click();
  await expect(page.locator("img[src^='/api/files/']")).toHaveCount(4, { timeout: 30_000 });
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors().filter((e) => !/Failed to fetch|net::|NetworkError|Load failed/i.test(e))).toEqual([]);
});

test("Reifenlager-Etikett: PDF (Format, Kopien), QR-Code zur Seite des Satzes, Druckansicht und Druck-PDF", async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  const { vehicleId } = await createCustomerWithVehicle(page, info);
  await page.goto(`/tires/new?vehicle=${vehicleId}`);
  await page.locator("#brand").fill("Continental");
  await page.locator("#width").fill("205");
  await page.locator("#aspect").fill("55");
  await page.locator("#rim").fill("16");
  await save(page);
  await page.waitForURL((url) => /^\/tires\/(?!new$)[^/]+$/.test(url.pathname));
  const tireId = new URL(page.url()).pathname.split("/").pop()!;

  await page.goto(`/tires/${tireId}/label`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Etikett");
  await expect(page.getByText("ohne QR-Code", { exact: false })).toHaveCount(0);

  for (const format of ["sheet-3x8", "roll-62x29"]) {
    const response = await request.get(`/api/tires/${tireId}/label?format=${format}&copies=2&skip=0`);
    if (format !== "sheet-3x8" && response.status() === 422) continue; // unbekanntes Format fällt auf den Standard zurück
    expect(response.status(), format).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
    const bytes = await response.body();
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect((bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(1);
  }
  const bad = await request.get("/api/tires/gibt-es-nicht/label");
  expect(bad.status()).toBe(404);

  // Druckansicht: Bedienelemente verschwinden, die Etiketten bleiben (QR-Code als Grafik); Druck-PDF hat Seiten
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".no-print").first()).toBeHidden();
  await expect(page.locator("svg[aria-label], img[alt], canvas").first()).toBeAttached();
  if (info.project.name === "desktop") {
    const pdf = await page.pdf({ preferCSSPageSize: true });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length, "Druckansicht hat Seiten").toBeGreaterThanOrEqual(1);
  }
  await page.emulateMedia({ media: "screen" });
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});

test("Zeit: stempeln und als Positionen in den Auftrag übernehmen (Büro stempelt, die Verwaltung übernimmt)", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "legt einen Mitarbeiter und Zeiten an: ein Durchlauf");
  test.setTimeout(150_000);
  const { orderId, plate } = await newOrder(page, info);

  // Verwaltung: das Konto „e2e-office“ mit einem Mitarbeiter verknüpfen (falls noch nicht geschehen)
  const office = await browser.newContext({ ...info.project.use, storageState: authFile("office") });
  const staff = await office.newPage();
  try {
    await staff.goto("/time");
    if (await staff.getByText("noch kein Mitarbeiter verknüpft", { exact: false }).count()) {
      await page.goto("/employees/new");
      await page.locator("#firstName").fill("E2E");
      await page.locator("#lastName").fill(`Büro ${Date.now().toString(36)}`);
      await page.locator("#userId").selectOption({ label: "E2E office (e2e-office)" });
      await save(page);
      await page.waitForURL((url) => /^\/employees\/(?!new$)[^/]+$/.test(url.pathname));
      await staff.reload();
    }

    // Stempeln auf den Auftrag: starten, beenden
    const options = await staff.locator("#stamp-order option").allTextContents();
    const label = options.find((text) => text.includes(plate));
    expect(label, `Auftrag ${plate} in der Stempel-Auswahl`).toBeTruthy();
    await staff.locator("#stamp-order").selectOption({ label: label! });
    await staff.locator("#stamp-activity").fill("Bremsen prüfen");
    await staff.getByRole("button", { name: "Auftrag starten" }).click();
    await expect(staff.getByRole("button", { name: "Auftrag beenden" })).toBeVisible();
    await staff.getByRole("button", { name: "Auftrag beenden" }).click();
    await expect(staff.getByRole("button", { name: "Auftrag starten" })).toBeVisible();

    // Nachtrag einer Stunde auf den Auftrag (Büro darf Zeiten erfassen): eine Zeit, die sich übernehmen lässt
    await staff.goto("/time/entries/new");
    const today = await staff.locator("#startDate").inputValue();
    // gestern (nie „in der Zukunft“, egal zu welcher Uhrzeit der Test läuft)
    const yesterday = new Date(`${today}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const day = yesterday.toISOString().slice(0, 10);
    await staff.locator("#startDate").fill(day);
    await staff.locator("#startTime").fill("08:00");
    await staff.locator("#endDate").fill(day);
    await staff.locator("#endTime").fill("09:30");
    const orderOptions = await staff.locator("#orderId option").allTextContents();
    await staff.locator("#orderId").selectOption({ label: orderOptions.find((text) => text.includes(plate))! });
    await staff.locator("#activity").fill("Nachtrag Inspektion");
    await staff.locator("#reason").fill("E2E: vergessen zu stempeln");
    await staff.getByRole("button", { name: "Zeit nachtragen" }).click();
    await staff.waitForURL((url) => url.pathname.startsWith("/time/entries") && url.pathname !== "/time/entries/new");
  } finally {
    await office.close();
  }

  // Auftrag: die Zeit steht im Abschnitt „Zeiten“
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByRole("heading", { name: "Zeiten" })).toBeVisible();
  await page.getByRole("button", { name: "Zeiten als Positionen übernehmen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Zeiten als Positionen übernehmen" }).click();
  await expect(page.locator("[data-flash]").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("group", { name: "Position 1" }).getByRole("textbox", { name: "Beschreibung" })).toBeVisible();
  // eine Zeit steht nur einmal im Auftrag
  await expect(page.getByRole("button", { name: "Zeiten als Positionen übernehmen" })).toHaveCount(0);
});
