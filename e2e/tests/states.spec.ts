import { expect, test } from "@playwright/test";
import { authFile } from "../support/env";
import { cspViolations, settle, watchCsp } from "../support/checks";
import { assertNoErrorPage, collectBrowserErrors, runPageChecks } from "../support/page-checks";

/**
 * Status- und Fehlerseiten laufen durch dieselben Prüfungen wie die Seiten der Inventur (Überbreite, Touch-Ziele, Eingabeschrift, axe in Hell und
 * Dunkel) – dazu ihre Barrierefreiheit (Fokus auf der Überschrift, eigener Titel, genau ein <main>, Fehlerseiten als Live-Region) – und die Erkennung
 * von Fehlerseiten in der Browser-CI wird an einer absichtlich erzeugten Fehlerseite selbst geprüft. Die Fehler entstehen über die Testseiten
 * `/e2e-state/…` und `/e2e-fault/…` (nur mit SCHRAUBEROS_E2E=1, gesetzt von e2e/start-server.mjs).
 */
type StateCase = {
  key: string;
  url: string;
  marker: string;
  /** StatusPage (Überschrift mit Fokus und Titel) – die Neuinstallation ist eine eigene feste Seite */
  statusPage: boolean;
  alert: boolean;
};

const STATES: StateCase[] = [
  { key: "state:nicht-gefunden", url: "/gibt-es-nicht", marker: "[data-status='not-found']", statusPage: true, alert: false },
  { key: "state:nicht-gefunden-datensatz", url: "/customers/gibt-es-nicht", marker: "[data-status='not-found']", statusPage: true, alert: false },
  { key: "state:fehler-im-rahmen", url: "/e2e-state/error", marker: "[data-status='error']", statusPage: true, alert: true },
  { key: "state:fehler-vollbild", url: "/e2e-fault/error", marker: "[data-status='error']", statusPage: true, alert: true },
  { key: "state:neuinstallation", url: "/e2e-fault/reinstall", marker: "[data-status='reinstall']", statusPage: false, alert: false },
];

test.describe("Status- und Fehlerseiten", () => {
  for (const state of STATES) {
    test(state.key, async ({ page }, info) => {
      await watchCsp(page);
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      await page.goto(state.url, { waitUntil: "load" });
      await expect(page.locator(state.marker)).toBeVisible();
      await settle(page);

      // genau ein <main>, und die Überschrift der Seite ist die einzige h1
      await expect(page.locator("main")).toHaveCount(1);
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toHaveCount(1);
      if (state.statusPage) {
        await expect(heading, "Fokus liegt auf der Überschrift").toBeFocused();
        await expect(page, "Seitentitel nennt, was passiert ist").toHaveTitle((await heading.innerText()).trim());
      }
      await expect(page.locator("[role='alert']").filter({ has: heading }), "Fehlerseiten sind eine Live-Region").toHaveCount(state.alert ? 1 : 0);

      await runPageChecks(page, info, state.key);
    });
  }

  test("state:kein-zugriff (Rolle ohne Recht)", async ({ browser }, info) => {
    const context = await browser.newContext({ storageState: authFile("mechanic"), ...info.project.use });
    const page = await context.newPage();
    try {
      await watchCsp(page);
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      await page.goto("/admin/users", { waitUntil: "load" });
      await page.waitForURL(/\/forbidden$/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("main")).toHaveCount(1);
      await settle(page);
      await runPageChecks(page, info, "state:kein-zugriff");
    } finally {
      await context.close();
    }
  });
});

test.describe("Erkennung von Fehlerseiten in der Browser-CI (Selbsttest)", () => {
  test("eine absichtlich erzeugte Fehlerseite wird erkannt: data-status, Browserfehler", async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    const response = await page.goto("/e2e-state/error", { waitUntil: "load" });
    // gestreamt steht der Statuscode schon auf 200 – genau deshalb reicht er als Prüfung nicht
    expect(response?.status()).toBe(200);
    await expect(page.locator("[data-status='error']")).toBeVisible();
    await expect(assertNoErrorPage(page, "/e2e-state/error")).rejects.toThrow(/Fehlerseite/);
    expect(browserErrors().length, "console.error der Fehlergrenze wird gesammelt").toBeGreaterThan(0);
  });

  test("eine gewöhnliche Seite gilt als fehlerfrei", async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    await page.goto("/help", { waitUntil: "load" });
    await settle(page);
    await assertNoErrorPage(page, "/help");
    expect(browserErrors()).toEqual([]);
  });

  test("unbekannte Zustände der Testseiten sind 404", async ({ page }) => {
    await page.goto("/e2e-state/gibt-es-nicht", { waitUntil: "load" });
    await expect(page.locator("[data-status='not-found']")).toBeVisible();
  });

  test("CSP-Erkennung: eine Seite mit verletzter Richtlinie liefert securitypolicyviolation (die Prüfung ist nicht blind)", async ({ page }) => {
    await watchCsp(page);
    await page.route("**/e2e-csp-selftest", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", headers: { "content-security-policy": "script-src 'none'" }, body: "<!doctype html><title>CSP</title><script>window.__ran = true</script>" }),
    );
    await page.goto("/e2e-csp-selftest");
    await settle(page);
    expect((await cspViolations(page)).join(" ")).toMatch(/script-src/);
  });

  test("Vermerk: Solange die CSP nur frame-ancestors enthält, bleibt die Prüfung der Verstöße in der Inventur wirkungslos", async ({ page }, info) => {
    const response = await page.goto("/login");
    const csp = response?.headers()["content-security-policy"] ?? "";
    if (!/\b(default-src|script-src)\b/.test(csp)) {
      info.annotations.push({ type: "hinweis", description: "CSP ohne default-src/script-src: securitypolicyviolation kann nicht auftreten. Mit der vollständigen CSP (P1a-7) wird die Prüfung wirksam." });
    }
    expect(csp, "die Antwort trägt eine CSP").not.toBe("");
  });
});
