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
    const context = await browser.newContext({ ...info.project.use, storageState: authFile("mechanic") });
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

  test("jede Antwort trägt die erzwungene CSP: Seiten, Statik und Programmschnittstelle (sonst ist die Prüfung der Verstöße in der Inventur blind)", async ({ browser, request, baseURL }) => {
    // Die Anmeldeseite wird für Angemeldete weitergeleitet: ohne Sitzung öffnen
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
    const header = (headers: Record<string, string>, name: string) => headers[name];
    const response = await page.goto("/login");
    const csp = header(response?.headers() ?? {}, "content-security-policy") ?? "";
    for (const directive of ["default-src 'self'", "script-src", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'self'"]) {
      expect(csp, `Seite /login: ${directive}`).toContain(directive);
    }
    expect(header(response?.headers() ?? {}, "content-security-policy-report-only"), "erzwungen, nicht nur gemeldet").toBeUndefined();
    // Statik und Health-Check laufen an der Proxy-Logik vorbei und bekommen ihre Header über next.config
    const health = await request.get("/api/health");
    expect(header(health.headers(), "content-security-policy") ?? "").toContain("default-src 'self'");
    const asset = await page.evaluate(() => Array.from(document.scripts).map((s) => s.src).find((src) => src.includes("/_next/static/")));
    if (asset) expect(header((await request.get(asset)).headers(), "content-security-policy") ?? "").toContain("default-src 'self'");
    } finally {
      await context.close();
    }
  });
  test("CSP mit Nonce (P1b-1): je Anfrage ein neuer Nonce, jedes Skript und jedes Stilelement der Seite trägt ihn – auch Anmeldung, Startseite und „Nicht gefunden“", async ({ request, playwright, baseURL }) => {
    const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1];
    // Die Anmeldeseite wird für Angemeldete weitergeleitet: ohne Sitzung abrufen, die übrigen Seiten mit der Sitzung des Administrators
    const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const fetchPage = async (url: string) => {
      const res = await (url === "/login" ? anonymous : request).get(url, { headers: { accept: "text/html" } });
      return { csp: res.headers()["content-security-policy"] ?? "", html: await res.text(), status: res.status() };
    };
    const first = await fetchPage("/login");
    const second = await fetchPage("/login");
    expect(nonceOf(first.csp), "Nonce in der Richtlinie").toBeTruthy();
    expect(nonceOf(first.csp), "bei jeder Anfrage neu").not.toBe(nonceOf(second.csp));
    expect(first.csp).toContain("'strict-dynamic'");
    expect(first.csp, "kein 'unsafe-inline' für Skripte und Stilelemente").not.toMatch(/(script-src|style-src) [^;]*'unsafe-inline'/);
    for (const url of ["/login", "/", "/gibt-es-nicht"]) {
      const { csp, html } = await fetchPage(url);
      const nonce = nonceOf(csp);
      expect(nonce, `${url}: Nonce`).toBeTruthy();
      const tags = [...html.matchAll(/<(script|style)\b[^>]*>/g)].map((m) => m[0]).filter((tag) => !/\bnomodule\b/i.test(tag)); // das Skript für alte Browser (noModule) läuft in keinem Browser mit CSP-Unterstützung
      expect(tags.length, `${url}: Skripte vorhanden`).toBeGreaterThan(0);
      for (const tag of tags) expect(tag, `${url}: ${tag.slice(0, 80)}`).toContain(`nonce="${nonce}"`);
    }
    await anonymous.dispose();
  });

  test("CSP je Antwortart (P1b-1, ZP3-S-F9): Programmschnittstelle default-src 'none', Statik die Rückfall-Richtlinie, nie zwei Köpfe, Permissions-Policy mit Kamera für die eigene Herkunft", async ({ request, browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const api = await request.get("/api/v1/customers");
    expect(api.headers()["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
    const health = await request.get("/api/health");
    expect(health.headers()["content-security-policy"] ?? "").not.toMatch(/nonce/);
    for (const res of [api, health, (await page.goto("/login"))!]) {
      expect(res.headers()["content-security-policy-report-only"], "erzwungen, nicht nur gemeldet").toBeUndefined();
      expect(res.headers()["permissions-policy"] ?? "").toContain("camera=(self)");
      expect(res.headers()["x-content-type-options"]).toBe("nosniff");
      // Next führt mehrere Köpfe gleichen Namens mit Komma zusammen: genau eine Richtlinie hat genau ein script-src bzw. default-src
      expect((res.headers()["content-security-policy"] ?? "").match(/default-src/g)?.length ?? 0).toBe(1);
    }
    await context.close();
  });
});
