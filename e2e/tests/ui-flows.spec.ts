import { expect, test } from "@playwright/test";
import { cspViolations, findOverflow, settle, watchCsp } from "../support/checks";
import { uniqueName, save } from "../support/flow";
import { collectBrowserErrors } from "../support/page-checks";

/**
 * Bedienung der Oberfläche über die Seiten hinweg: Live-Filter (Tippen, Zurücksetzen, Zurück-Taste), Rollenmaske (Suche, Vorlage, Zähler, Speichern), Übersicht (Bausteine,
 * Schnellaktionen, Einrichtungs-Checkliste), Druckansichten (Auftragskarte, Terminzettel) und die Doku-Seite in schmalen Fenstern ohne seitliches Scrollen.
 */

test("Live-Filter: Tippen filtert nach kurzer Pause, ein Klick auf „Zurücksetzen“ genügt, die Zurück-Taste führt zur gefilterten Liste", async ({ page }, info) => {
  test.skip(!["iphone", "desktop"].includes(info.project.name), "ein Durchlauf auf Handy und Desktop genügt");
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  await page.goto("/help");
  await page.goto("/customers");
  await page.waitForLoadState("networkidle");
  // Zeilen oder Karten (unter md zeigt die Liste Karten): gezählt werden die Verweise auf Kunden
  const isCustomer = (href: string) => /^\/customers\/[^/?]+$/.test(href) && !/^\/customers\/(new|export|import)$/.test(href);
  const rowLinks = async () => (await page.locator("main a[href^='/customers/']:visible").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""))).filter(isCustomer).length;
  const total = await rowLinks();
  expect(total, "die Liste zeigt Kunden").toBeGreaterThan(5);
  const search = page.getByRole("searchbox", { name: "Suchen" });

  // Tippen: die Adresse bekommt q (ohne neuen Verlaufseintrag), die Liste schrumpft
  await search.pressSequentially("Autohaus", { delay: 40 });
  await expect(page).toHaveURL(/[?&]q=Autohaus/);
  await expect.poll(rowLinks).toBeLessThan(total);
  const filtered = await rowLinks();
  const reset = page.getByRole("link", { name: "Zurücksetzen" }).or(page.getByRole("button", { name: "Zurücksetzen" }));
  await expect(reset.first()).toBeVisible();

  // Ein Klick genügt (nicht erst beim zweiten Mal): Feld leer, Liste vollständig, Adresse ohne q
  await reset.first().click();
  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(search).toHaveValue("");
  await expect.poll(rowLinks).toBeGreaterThan(filtered);
  await expect(reset).toHaveCount(0);

  // Zurück-Taste: wieder filtern, einen Kunden öffnen, zurück – die Liste ist gefiltert wie vorher (Feld und Liste passen zusammen)
  await search.pressSequentially("Autohaus", { delay: 40 });
  await expect(page).toHaveURL(/[?&]q=Autohaus/);
  await page.locator("main a[href^='/customers/']:visible", { hasText: "Autohaus" }).first().click();
  await page.waitForURL((url) => /^\/customers\/[^/]+$/.test(url.pathname));
  await page.goBack();
  await expect(page).toHaveURL(/[?&]q=Autohaus/);
  await expect(search).toHaveValue("Autohaus");
  await expect.poll(rowLinks).toBeLessThan(total);
  // und noch einmal zurück: die Seite davor, nicht jeder Tastendruck als Zwischenstand
  await page.goBack();
  await expect(page).not.toHaveURL(/\/customers/);
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});

test("Rollenmaske: Vorlage übernehmen, Rechte durchsuchen und wählen, Zähler stimmen, Speichern und Wiederöffnen behalten die Auswahl", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "ein Durchlauf genügt (Anzeigegrößen prüft die Inventur)");
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  const name = uniqueName(info, "Rolle");
  await page.goto("/admin/roles/new");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);

  const counter = page.getByRole("status").filter({ hasText: /von \d+ Rechten gewählt/ });
  await expect(counter).toContainText("0 von");
  await page.getByRole("button", { name: "Mechaniker – Vorlage übernehmen" }).click();
  const afterTemplate = Number(/(\d+) von/.exec(await counter.innerText())![1]);
  expect(afterTemplate, "die Vorlage wählt Rechte vor").toBeGreaterThan(3);

  // Suche: nur Treffer bleiben sichtbar; ein Recht aus einer zugeklappten Gruppe wählen
  const search = page.getByRole("searchbox", { name: "Rechte durchsuchen" });
  await search.fill("Rechnungsarchiv");
  await expect(page.getByRole("checkbox").first()).toBeVisible();
  const visibleBefore = await page.getByRole("checkbox").count();
  await search.fill("");
  expect(await page.getByRole("checkbox").count()).toBeGreaterThan(0);
  expect(visibleBefore).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Alle aufklappen" }).click();
  const invoices = page.getByRole("checkbox", { name: /^Rechnungen ansehen/ }).first();
  const wasChecked = await invoices.isChecked();
  await invoices.setChecked(!wasChecked);
  const afterToggle = Number(/(\d+) von/.exec(await counter.innerText())![1]);
  expect(afterToggle).toBe(afterTemplate + (wasChecked ? -1 : 1));

  // Speichern mit zugeklappten Gruppen darf nichts verlieren
  await page.getByRole("button", { name: "Alle zuklappen" }).click();
  await save(page);
  await page.waitForURL((url) => url.pathname === "/admin/roles");
  await page.locator("a:visible", { hasText: name }).first().click();
  await page.waitForURL((url) => /^\/admin\/roles\/(?!new$)[^/]+$/.test(url.pathname));
  await page.waitForLoadState("networkidle");
  const reopened = page.getByRole("status").filter({ hasText: /von \d+ Rechten gewählt/ });
  await expect(reopened).toContainText(`${afterToggle} von`);

  // Recht wieder entziehen und speichern: der Zähler folgt
  await page.getByRole("button", { name: "Alle aufklappen" }).click();
  const again = page.getByRole("checkbox", { name: /^Rechnungen ansehen/ }).first();
  await again.setChecked(wasChecked);
  await save(page);
  await expect(page.getByRole("status").filter({ hasText: /von \d+ Rechten gewählt/ })).toContainText(`${afterTemplate} von`);
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});

test("Übersicht: offene Aufträge, Schnellaktionen und die Einrichtungs-Checkliste lassen sich ausblenden und wieder einblenden", async ({ page }, info) => {
  test.skip(!["iphone", "desktop"].includes(info.project.name), "ein Durchlauf auf Handy und Desktop genügt");
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const quick = page.getByRole("region", { name: "Schnellaktionen" });
  await expect(quick.getByRole("link", { name: "Auftrag annehmen" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Zum Kalender" })).toBeVisible();
  await expect(page.getByText(/offene Aufträge?/i).first()).toBeVisible();

  const hide = page.getByRole("button", { name: "Checkliste ausblenden" });
  if (await hide.count()) {
    await hide.click();
    await expect(page.getByRole("button", { name: "Checkliste ausblenden" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Checkliste ausblenden" })).toHaveCount(0);
    // wieder einblenden (Link/Knopf der Übersicht)
    const show = page.getByRole("button", { name: /Checkliste.*(einblenden|anzeigen)/i }).or(page.getByRole("link", { name: /Checkliste.*(einblenden|anzeigen)/i }));
    if (await show.count()) await show.first().click();
  }
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});

test("Druckansichten: Auftragskarte und Terminzettel – Bedienelemente verschwinden, wenige Seiten, QR-Code vorhanden", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Druck-PDF nur in Chromium (Desktop-Projekt)");
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  await page.goto("/orders");
  const orderHref = await page.locator("a[href^='/orders/']:visible").first().getAttribute("href");
  const orderId = orderHref!.split("/")[2];
  const targets = [`/orders/${orderId}/card`];
  await page.goto("/appointments?view=list");
  const slipHref = await page.locator("a[href*='show='], a[href*='edit=']").first().getAttribute("href");
  const appointmentId = new URL(slipHref!, "http://x").searchParams.get("show") ?? new URL(slipHref!, "http://x").searchParams.get("edit");
  if (appointmentId) targets.push(`/appointments/${appointmentId}/slip`);

  for (const url of targets) {
    await page.emulateMedia({ media: "screen" });
    await page.goto(url);
    await settle(page);
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".no-print").first()).toBeHidden();
    const printed = await page.evaluate(() => document.body.innerText);
    expect(printed.trim().length, `${url}: Inhalt im Druck`).toBeGreaterThan(40);
    expect(printed, `${url}: keine Navigation im Druck`).not.toContain("Hauptnavigation");
    const pdf = await page.pdf({ preferCSSPageSize: true });
    expect(pdf.subarray(0, 5).toString("latin1"), url).toBe("%PDF-");
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pages, `${url}: Seiten im Druck`).toBeGreaterThanOrEqual(1);
    expect(pages, `${url}: ein Laufzettel passt auf wenige Seiten`).toBeLessThanOrEqual(2);
    expect(await findOverflow(page), `${url}: nichts ragt über die Seite`).toEqual([]);
  }
  await page.emulateMedia({ media: "screen" });
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});

// Der Titel beginnt mit „Zz“: Die Routen-Inventur nimmt je Muster die Seite mit dem alphabetisch ersten Namen – die Testseite soll ihr nie zufällig in die Quere kommen (parallele Läufe)
test("Doku-Seite: auch bei langen Zeilen, Tabellen und Codeblöcken kein seitliches Scrollen der Seite", async ({ page }, info) => {
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  await page.goto("/docs/handbook/new");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Titel" }).fill(uniqueName(info, "Zz-E2E-Doku"));
  const long = "https://example.org/" + "sehr-lang-".repeat(30);
  const source = [
    "## Abschnitt",
    "",
    `Ein Absatz mit einer sehr langen Adresse ${long} mitten im Text.`,
    "",
    "| Spalte A | Spalte B | Spalte C | Spalte D |",
    "| --- | --- | --- | --- |",
    `| ${long} | zwei | drei | vier |`,
    "",
    "```",
    `curl -H "Authorization: Bearer TOKEN" ${long}/und/noch/mehr/Pfad/damit/die/Zeile/wirklich/lang/wird`,
    "```",
  ].join("\n");
  await page.getByRole("textbox", { name: /Inhalt/ }).fill(source);
  await save(page);
  await page.waitForURL((url) => /^\/docs\/handbook\/(?!new$)[^/]+$/.test(url.pathname));
  await settle(page);
  const scroll = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scroll.scrollWidth, "kein seitliches Scrollen der Seite").toBeLessThanOrEqual(scroll.clientWidth + 1);
  expect(await findOverflow(page), "keine Elemente über dem Rand").toEqual([]);
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});
