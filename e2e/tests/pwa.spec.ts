import { expect, test } from "@playwright/test";

/**
 * Installierbare App (P3-5) an der echten Antwort des gebauten Servers: Manifest, Symbole, Service Worker (Header, CSP), Offline-Seite und Logo ohne Anmeldung – und im Browser
 * mit **aktivem Service Worker**: Offline-Seite statt Browserfehler, Downloads und PDF-Vorschau unberührt, Zwischenspeicher nur mit Offline-Seite und Programmdateien.
 * Alle anderen Tests laufen mit `serviceWorkers: "block"` (playwright.config.ts), damit ein Zwischenspeicher keine Messung verfälscht. Nur im Desktop-Projekt (unabhängig von der Größe).
 */
test.use({ serviceWorkers: "allow" });
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "unabhängig von der Anzeigegröße");
});

test("ohne Anmeldung erreichbar: Manifest, Symbole, Service Worker, Offline-Seite; das Logo antwortet nie mit 401", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const manifest = await anonymous.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  const json = await manifest.json();
  expect(json).toMatchObject({ display: "standalone", start_url: "/", scope: "/" });
  for (const icon of json.icons as Array<{ src: string; type: string }>) {
    const res = await anonymous.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()["content-type"]).toContain(icon.type);
  }

  const sw = await anonymous.get("/sw.js?v=test");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["cache-control"]).toContain("no-cache");
  expect(sw.headers()["content-type"]).toMatch(/javascript/);
  expect(sw.headers()["content-security-policy"]).toContain("script-src 'self'");
  expect(sw.headers()["content-security-policy"]).not.toContain("nonce-");

  const offline = await anonymous.get("/offline", { maxRedirects: 0 });
  expect(offline.status()).toBe(200);
  expect(offline.headers()["content-type"]).toContain("text/html");
  expect(await offline.text()).toContain("Keine Verbindung");

  expect([200, 404]).toContain((await anonymous.get("/api/logo")).status());
  await anonymous.dispose();
});

test("mit aktivem Service Worker: ohne Netz erscheint die Offline-Seite, Downloads und PDF-Vorschau laufen unberührt, gespeichert ist nur Harmloses", async ({ page, context }) => {
  await page.goto("/");
  const active = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.scriptURL ?? null;
  });
  expect(active).toContain("/sw.js?v=");
  // Die Seite wird erst nach dem Neuladen vom Service Worker gesteuert; die Offline-Seite liegt danach im Zwischenspeicher
  await page.reload();
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).some((name) => name.startsWith("sos-offline-") ))).toBe(true);

  // Zwischenspeicher: nur die Offline-Seite und Programmdateien – nie eine Seite der Anwendung, nie /api
  const stored = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) out.push(new URL(request.url).pathname);
    return out;
  });
  expect(stored.filter((p) => p !== "/offline" && !p.startsWith("/_next/static/"))).toEqual([]);

  // Downloads und die Dateirouten laufen am Service Worker vorbei: eine Anfrage an /api kommt vom Server (nie die Offline-Seite), auch ohne Netz scheitert sie wie ohne Service Worker
  const direct = await page.evaluate(async () => (await fetch("/api/health")).status);
  expect(direct).toBe(200);

  await context.setOffline(true);
  await page.goto("/customers").catch(() => undefined);
  await expect(page.getByRole("heading", { name: "Keine Verbindung · No connection" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Erneut versuchen" })).toBeVisible();
  const apiOffline = await page.evaluate(() => fetch("/api/health").then(() => "antwort", () => "netzfehler"));
  expect(apiOffline, "/api/* wird nie durch die Offline-Seite ersetzt").toBe("netzfehler");
  await context.setOffline(false);
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
