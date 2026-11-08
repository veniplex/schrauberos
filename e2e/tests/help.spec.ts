import { expect, test } from "@playwright/test";
import { cspViolations, findOverflow, settle, watchCsp } from "../support/checks";
import { assertNoErrorPage, collectBrowserErrors } from "../support/page-checks";
import { loadInventory } from "../support/inventory";

/**
 * Hilfe: Jedes Kapitel, das die Hilfeseite anbietet, lässt sich öffnen (Überschrift, keine Fehlerseite, keine Überbreite, keine Browserfehler), und jeder „Hilfe zu dieser Seite“-Link der
 * Seiten führt zu einem vorhandenen Kapitel (keine Verweise ins Leere).
 */
test("jedes Kapitel der Hilfe öffnet sich: Überschrift, Inhaltsverzeichnis, keine Überbreite", async ({ page }, info) => {
  test.skip(!["iphone", "desktop"].includes(info.project.name), "ein Durchlauf auf Handy und Desktop genügt");
  test.setTimeout(180_000);
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  await page.goto("/help");
  const chapters = [...new Set(await page.locator("a[href^='/help/']").evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).getAttribute("href")!)))].filter((href) => href !== "/help");
  expect(chapters.length, "die Hilfe bietet Kapitel an").toBeGreaterThan(15);
  for (const href of chapters) {
    const response = await page.goto(href, { waitUntil: "load" });
    expect(response?.status(), href).toBe(200);
    await expect(page.locator("[data-status='not-found']"), `${href}: nicht gefunden`).toHaveCount(0);
    await assertNoErrorPage(page, href);
    await expect(page.getByRole("heading", { level: 1 }), `${href}: Überschrift`).toBeVisible();
    expect((await page.getByRole("heading", { level: 1 }).innerText()).trim().length, `${href}: Titel nicht leer`).toBeGreaterThan(2);
    await settle(page);
    expect(await findOverflow(page), `${href}: Überbreite`).toEqual([]);
  }
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});

test("die Hilfe-Links der Seiten führen zu vorhandenen Kapiteln", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Verweise hängen nicht von der Anzeigegröße ab");
  test.setTimeout(240_000);
  const hrefs = new Map<string, string>();
  for (const entry of loadInventory().filter((e) => !e.public && e.kind !== "modal" && e.kind !== "print")) {
    await page.goto(entry.url, { waitUntil: "load" });
    const link = page.getByRole("link", { name: "Hilfe zu dieser Seite" }).first();
    if (await link.count()) hrefs.set(await link.getAttribute("href").then((h) => h!), entry.key);
  }
  expect(hrefs.size, "mehrere Seiten verweisen auf die Hilfe").toBeGreaterThan(10);
  for (const [href, from] of hrefs) {
    const response = await page.goto(href, { waitUntil: "load" });
    expect(response?.status(), `${href} (von ${from})`).toBe(200);
    await expect(page.locator("[data-status='not-found']"), `${href} (von ${from}): Kapitel fehlt`).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});
