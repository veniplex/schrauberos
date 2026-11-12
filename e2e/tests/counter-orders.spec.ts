import { expect, test } from "@playwright/test";
import { startFakeSmtp, type FakeSmtp } from "../support/fake-smtp";
import { createAppointment, createCustomerWithVehicle, save } from "../support/flow";
import { allowLoopbackTargets } from "../support/local-targets";
import { collectBrowserErrors } from "../support/page-checks";
import { watchCsp, cspViolations } from "../support/checks";

/**
 * Tresen-Durchlauf „Termin → Auftrag → Rechnung → PDF → Mail“ (der Kern des Werkstattalltags), wie ihn ein Anwender klickt:
 * Kunde → Fahrzeug → Termin → Auftrag aus dem Termin → Positionen → Arbeit beginnen, fertig melden, abschließen → Rechnung aus dem Auftrag → Festschreiben → PDF → E-Mail
 * (an einen kleinen SMTP-Empfänger in diesem Test; der Versand wird in Einstellungen → E-Mail eingerichtet, wie es die Verwaltung tut).
 * Nur im Desktop-Projekt (der Versand ist eine globale Einstellung); die Bedienung auf dem Handy deckt `counter-mobile.spec.ts` ab.
 */
test.describe.configure({ mode: "serial" });

let smtp: FakeSmtp | undefined;
test.afterAll(async () => {
  await smtp?.close();
});

test("Termin → Auftrag → Positionen → Abschluss → Rechnung → Festschreiben → PDF → E-Mail", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "globale Mail-Einstellung: ein Durchlauf");
  test.setTimeout(240_000);
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);

  // 1. Kunde, Fahrzeug und Termin
  const { lastName, plate, vehicleId } = await createCustomerWithVehicle(page, info);
  const appointment = await createAppointment(page, vehicleId, `Inspektion ${lastName}`);

  // 2. Auftrag aus dem Termin (Fahrzeug und Kundenwunsch kommen aus dem Termin)
  // Ein Tipp auf den Termin öffnet für Bearbeiter das Formular (`edit`): „Auftrag aus Termin“ steht dort wie in der Leseansicht
  await page.goto(`/appointments?view=list&edit=${appointment.id}`);
  await page.getByRole("link", { name: "Auftrag aus Termin" }).click();
  await page.waitForURL(/\/orders\/new\?appointment=/);
  await expect(page.getByText(plate).first()).toBeVisible();
  await expect(page.locator("#request")).toHaveValue(appointment.title);
  await page.locator("#request").fill("Inspektion und Ölwechsel");
  await page.locator("#mileageKm").fill("45000");
  await save(page);
  await page.waitForURL((url) => /^\/orders\/(?!new$)[^/]+$/.test(url.pathname));
  const orderId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1 })).toContainText(plate);

  // 3. Positionen erfassen und speichern (Arbeit und Teil)
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  const first = page.getByRole("group", { name: "Position 1" });
  await first.getByRole("textbox", { name: "Beschreibung" }).fill("Ölwechsel inkl. Filter");
  await first.getByLabel("Einzelpreis netto").fill("89,90");
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  const second = page.getByRole("group", { name: "Position 2" });
  await second.getByRole("textbox", { name: "Beschreibung" }).fill("Luftfilter");
  await second.getByLabel("Art").selectOption("part");
  await second.getByLabel("Menge").fill("2");
  await second.getByLabel("Einzelpreis netto").fill("12,50");
  await second.getByLabel("Steuersatz").selectOption({ label: "19 %" });
  await expect(page.getByText("Brutto").first()).toBeVisible();
  await page.getByRole("button", { name: "Positionen speichern" }).click();
  await expect(page.locator("[data-flash]")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("group", { name: "Position 2" }).getByRole("textbox", { name: "Beschreibung" })).toHaveValue("Luftfilter");

  // 4. Ablauf: Arbeit beginnen, fertig melden, abschließen (Rückfrage im Dialog der Anwendung)
  await page.getByRole("button", { name: "Arbeit beginnen" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "In Arbeit" }).filter({ hasText: "aktuell" })).toBeVisible();
  await page.getByRole("button", { name: "Fertig melden" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Fertig, abholbereit" }).filter({ hasText: "aktuell" })).toBeVisible();
  await page.getByRole("button", { name: "Abschließen (abgeholt)" }).click();
  await page.getByRole("dialog", { name: "Abschließen (abgeholt)?" }).getByRole("button", { name: "Abschließen (abgeholt)" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Abgeholt" }).filter({ hasText: "aktuell" })).toBeVisible();

  // 5. Rechnung aus dem Auftrag: Entwurf, Prüfliste vollständig (Werkstattprofil und Kundenanschrift), Festschreiben
  await page.getByRole("link", { name: "Rechnung aus Auftrag" }).click();
  await page.waitForURL(new RegExp(`/billing/new\\?order=${orderId}`));
  await page.getByRole("button", { name: "Entwurf anlegen" }).click();
  await page.waitForURL((url) => /^\/billing\/(?!new$)[^/]+$/.test(url.pathname));
  const invoiceUrl = page.url();
  await expect(page.getByRole("row", { name: /Ölwechsel inkl\. Filter/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Luftfilter/ })).toBeVisible();
  await expect(page.getByText("Alle Pflichtangaben sind vorhanden")).toBeVisible();
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await page.getByRole("dialog", { name: "Festschreiben?" }).getByRole("button", { name: "Festschreiben" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Festgeschrieben");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/\d{4}-\d{4}/);
  // Festgeschrieben heißt: kein „Bearbeiten“ und kein Löschen mehr
  await expect(page.getByRole("link", { name: "Bearbeiten" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Entwurf löschen" })).toHaveCount(0);

  // 6. PDF: die Datei selbst (Magic Bytes, Kopfzeilen, Seitenzahl) und die Vorschau im Rahmen ohne Verstoß gegen die CSP
  const pdfLink = page.getByRole("group", { name: "PDF-Datei" }).getByRole("link", { name: "Öffnen" });
  const pdfHref = (await pdfLink.getAttribute("href"))!;
  const pdf = await request.get(pdfHref);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect(pdf.headers()["x-content-type-options"]).toBe("nosniff");
  const bytes = await pdf.body();
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(2_000);
  expect((bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length, "mindestens eine Seite").toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "Vorschau anzeigen" }).click();
  await expect(page.locator("iframe").first()).toBeVisible();

  // 7. E-Mail: Versand einrichten (Einstellungen → E-Mail, Klartext an einen lokalen Empfänger) und die Rechnung senden
  smtp = await startFakeSmtp();
  await allowLoopbackTargets(request);
  await page.goto("/settings?tab=mail");
  await page.locator('input[name="enabled"]').check();
  await page.locator("#host").fill("127.0.0.1");
  await page.locator("#port").fill(String(smtp.port));
  await page.locator("#security").selectOption("none");
  await page.locator('input[name="plainConfirmed"]').check();
  await page.locator('input[name="allowPrivate"]').check();
  await page.locator("#fromAddress").fill("werkstatt@example.org");
  await save(page);
  await expect(page.locator("[data-flash]").first()).toBeVisible();

  await page.goto(invoiceUrl);
  await expect(page.getByRole("heading", { name: "Per E-Mail senden" })).toBeVisible();
  await expect(page.getByText("erika@example.org").first()).toBeVisible();
  await page.getByRole("button", { name: "Senden", exact: true }).click();
  await expect(page.locator("[data-flash]").first()).toBeVisible();
  console.log("MAILFLASH", await page.locator("[data-flash]").first().innerText());

  // Die Nachricht geht über die Warteschlange (Job-Runner) raus; der Empfänger bekommt sie mit dem PDF im Anhang
  await expect.poll(() => smtp!.mails.length, { timeout: 90_000, message: "die Rechnung kommt beim SMTP-Empfänger an" }).toBeGreaterThan(0);
  const mail = smtp.mails[0];
  expect(mail.to).toEqual(["erika@example.org"]);
  expect(mail.from).toBe("werkstatt@example.org");
  expect(mail.data).toMatch(/Content-Type: application\/pdf/i);
  expect(mail.data).toMatch(/filename=/i);

  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});
