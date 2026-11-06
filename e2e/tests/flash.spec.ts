import { expect, test } from "@playwright/test";

/**
 * Meldung nach einer Server Action ohne Formularzustand (Löschen per `<form action>`): Genau **eine** Meldung erscheint, sie liegt in einer Live-Region, die schon vor der
 * Meldung im Dokument stand (sonst sagen Screenreader sie nicht an), und das Flash-Cookie ist danach weg (die Meldung kommt nicht bei jedem Neuladen wieder).
 * Lauf im Browser, weil das Zusammenspiel von Cookie, Layout und Client-Komponente nur dort echt ist (Komponenten- und Regionentest: `flash-message.test.ts`).
 */
test("Löschen per Formular zeigt genau eine Meldung in einer Live-Region, das Cookie ist danach weg", async ({ page, context }, info) => {
  test.skip(!["iphone", "desktop"].includes(info.project.name), "ein Durchlauf auf Handy und Desktop genügt");
  const lastName = `Flash-${info.project.name}-${Date.now().toString(36)}`;

  // Kunde ohne Verknüpfungen anlegen (löschbar)
  await page.goto("/customers/new");
  await page.locator("#lastName").fill(lastName);
  await page.getByRole("button", { name: "Speichern" }).click();
  await page.waitForURL((url) => /^\/customers\/(?!new$)[^/]+$/.test(url.pathname));

  // Die Live-Regionen sind schon da, bevor es eine Meldung gibt (leer)
  const regions = page.locator("[data-flash-region]");
  await expect(regions).toHaveCount(2);
  await expect(page.locator('[data-flash-region="polite"]')).toHaveAttribute("aria-live", "polite");
  await expect(page.locator('[data-flash-region="assertive"]')).toHaveAttribute("aria-live", "assertive");
  await expect(page.locator('[data-flash-region="polite"]')).toBeEmpty();

  // Löschen (Bestätigung des Browsers annehmen)
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Kunde löschen" }).click();
  await page.waitForURL((url) => url.pathname === "/customers");

  // Genau eine Meldung, in der höflichen Region
  const messages = page.locator("[data-flash]");
  await expect(messages).toHaveCount(1);
  await expect(page.locator('[data-flash-region="polite"] [data-flash="success"]')).toBeVisible();
  await expect(page.locator('[data-flash-region="assertive"]')).toBeEmpty();

  // Das Cookie ist weg, ein Neuladen zeigt keine zweite Meldung
  await expect.poll(async () => (await context.cookies()).some((c) => /(^|__Host-)so_flash$/.test(c.name))).toBe(false);
  await page.reload();
  await expect(page.locator("[data-flash]")).toHaveCount(0);
  await expect(page.locator('[data-flash-region="polite"]')).toBeEmpty();
});
