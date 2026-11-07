import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { startHttpsProxy, type HttpsProxy } from "../support/https-proxy";
import { ADMIN_USER, BASE_URL, HTTPS_PORT, HTTPS_URL, TEST_PASSWORD, authFile } from "../support/env";

/**
 * HTTPS hinter einem Reverse Proxy (selbstsigniertes Zertifikat, `x-forwarded-proto: https`): Das Sitzungs-Cookie heißt dann `__Host-so_session` und ist
 * `Secure`; gelesen wird nur dieser Name (Cookie Tossing); Abmelden löscht es wirklich. Die Einheitentests prüfen die Logik (src/server/auth/login.test.ts,
 * src/proxy.test.ts) – hier die echte Antwort des Servers im Browser. Läuft nur im Desktop-Projekt (unabhängig von der Anzeigegröße).
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] }, baseURL: HTTPS_URL, ignoreHTTPSErrors: true });

// Der Proxy gehört dem Desktop-Projekt allein (ein Port, die anderen Projekte laufen parallel und überspringen die Tests)
let proxy: HttpsProxy | undefined;
test.beforeAll(async ({}, info) => {
  if (info.project.name === "desktop") proxy = await startHttpsProxy({ target: BASE_URL, port: HTTPS_PORT });
});
test.afterAll(async () => {
  await proxy?.close();
});
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "unabhängig von der Anzeigegröße");
});

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator("#username").fill(ADMIN_USER);
  await page.locator("#password").fill(TEST_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

test("Anmelden über HTTPS setzt __Host-so_session (Secure, HttpOnly, Pfad /, ohne Domain) und kein Klartext-Cookie", async ({ page, context }) => {
  await signIn(page);
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === "__Host-so_session");
  expect(session, "Sitzungs-Cookie mit __Host-Präfix").toBeDefined();
  expect(session).toMatchObject({ secure: true, httpOnly: true, path: "/", sameSite: "Lax" });
  expect(cookies.map((c) => c.name)).not.toContain("so_session");
  // Das Cookie trägt die Sitzung wirklich
  await page.goto("/account");
  await expect(page).toHaveURL(/\/account$/);
});

test("ein untergeschobenes Klartext-Cookie zählt über HTTPS nicht (Cookie Tossing)", async ({ page, context }) => {
  // Gültiges Sitzungs-Token aus dem HTTP-Betrieb (Administrator-Sitzung der Konfiguration), als Klartext-Cookie auf der HTTPS-Herkunft abgelegt
  const state = JSON.parse(readFileSync(authFile("admin"), "utf8")) as { cookies: { name: string; value: string }[] };
  const token = state.cookies.find((c) => c.name === "so_session")?.value;
  expect(token, "Sitzung des Administrators aus der Einrichtung").toBeTruthy();
  await context.addCookies([{ name: "so_session", value: token!, url: HTTPS_URL }]);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login/);
});

test("Abmelden über HTTPS entfernt __Host-so_session wirklich", async ({ page, context }) => {
  await signIn(page);
  expect((await context.cookies()).map((c) => c.name)).toContain("__Host-so_session");
  await page.getByRole("button", { name: "E2E Administrator" }).click();
  await page.getByRole("button", { name: "Abmelden" }).click();
  await page.waitForURL(/\/login/, { timeout: 30_000 });
  expect((await context.cookies()).map((c) => c.name)).not.toContain("__Host-so_session");
  // ohne Sitzung führt eine geschützte Seite zur Anmeldung
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login/);
});
