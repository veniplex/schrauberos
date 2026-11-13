import { createHmac } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { cspViolations, watchCsp } from "../support/checks";
import { TEST_PASSWORD } from "../support/env";
import { save, uniqueName } from "../support/flow";
import { allowLoopbackTargets } from "../support/local-targets";
import { collectBrowserErrors } from "../support/page-checks";

/**
 * Verwaltung und IT, wie die Administration es klickt – jeweils mit Prüfung des Ergebnisses von außen (echte Aufrufe, echte Empfänger auf 127.0.0.1):
 * API-Token (Passwortabfrage, Klartext nur einmal, Aufruf mit dem Token), Webhook (Test-Ereignis an einen lokalen Empfänger, Signatur nachgerechnet), IT-Tresor (Passwortabfrage,
 * Ausblenden nach 30 s, keine Zugangsdaten in Liste oder Seite, `no-store`), Überwachung (Ziel gegen einen lokalen Port, Messung) und das Kalender-Abo (Adresse, Abruf ohne Sitzung).
 * Nur im Desktop-Projekt: Sie verändern globale Einstellungen und hängen nicht von der Anzeigegröße ab (Tresor und Überwachung haben je einen Durchlauf am Handy in `admin-mobile`-Prüfungen der Inventur).
 */
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "legt globale Einstellungen und Datensätze an: ein Durchlauf");
});

const confirm = (page: Page, label: string | RegExp, password = TEST_PASSWORD) => page.getByRole("textbox", { name: label }).fill(password);

const VAULT_PASSPHRASE = "E2E-Tresor-Passphrase für den Browsertest 2026";

/** Der Tresor ist nach dem Start gesperrt und beim ersten Lauf noch nicht eingerichtet: einrichten bzw. entsperren (so wie eine Person es klickt). */
async function ensureVaultUnlocked(page: Page) {
  await page.goto("/docs/vault");
  const setup = page.getByRole("button", { name: "Tresor einrichten" });
  const unlock = page.getByRole("button", { name: "Tresor entsperren", exact: true });
  const lock = page.getByRole("button", { name: "Tresor sperren" });
  await expect(setup.or(unlock).or(lock)).toBeVisible();
  if (await lock.isVisible()) return;
  if (await setup.isVisible()) {
    await page.getByLabel("Tresor-Passphrase").fill(VAULT_PASSPHRASE);
    await page.getByLabel("Passphrase wiederholen").fill(VAULT_PASSPHRASE);
    await page.getByLabel("Eigenes Passwort (zur Bestätigung)").fill(TEST_PASSWORD);
    await setup.click();
  } else {
    await page.getByLabel("Tresor-Passphrase").fill(VAULT_PASSPHRASE);
    await page.getByLabel("Eigenes Passwort (zur Bestätigung)").first().fill(TEST_PASSWORD);
    await unlock.click();
  }
  await expect(page.getByRole("button", { name: "Tresor sperren" })).toBeVisible();
}

test("API-Token: anlegen mit Passwortabfrage, der Klartext erscheint nur einmal, der Aufruf mit dem Token klappt und das Token lässt sich widerrufen", async ({ page, playwright, baseURL }, info) => {
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  const name = uniqueName(info, "Token");
  await page.goto("/admin/api/tokens/new");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("checkbox", { name: /^Termine ansehen/ }).check();

  // ohne richtiges Passwort wird nichts angelegt
  await confirm(page, "Eigenes Passwort", "falsches-Passwort-123");
  await page.getByRole("button", { name: "Token anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Token angelegt" })).toHaveCount(0);
  await expect(page.locator("[data-form-errors]")).toBeVisible();

  await confirm(page, "Eigenes Passwort");
  await page.getByRole("button", { name: "Token anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Token angelegt" })).toBeVisible();
  // verborgen, bis man „Anzeigen“ wählt; nie in der Adresse
  const secret = page.getByRole("textbox", { name: "API-Token (Klartext)" });
  await expect(secret).toHaveValue("Verborgen");
  expect(page.url()).not.toContain("token=");
  await page.getByRole("button", { name: "Anzeigen", exact: true }).click();
  const token = await secret.inputValue();
  expect(token).toMatch(/^\S{20,}$/);

  // der Aufruf mit dem Token (Kopf Authorization, ohne Sitzung)
  const api = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  const allowed = await api.get("/api/v1/appointments");
  expect(allowed.status()).toBe(200);
  expect(allowed.headers()["content-type"]).toContain("application/json");
  expect(allowed.headers()["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
  expect((await api.get("/api/v1/customers")).status(), "ohne das Recht: verboten").toBe(403);
  expect((await api.get("/api/v1/admin/users")).status(), "Verwaltung ist nie eine API-Ressource").toBe(404);

  // nach dem Neuladen ist der Klartext weg; in der Liste steht nur der Name; Widerruf wirkt sofort
  await page.goto("/admin/api");
  await expect(page.getByText(token)).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole("button").first().click();
  await page.getByRole("dialog").getByRole("button").last().click();
  await expect.poll(async () => (await api.get("/api/v1/appointments")).status(), { timeout: 15_000 }).toBe(401);
  await api.dispose();
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});

test("Webhook: anlegen, Test-Ereignis an einen lokalen Empfänger – die Signatur stimmt mit dem angezeigten Geheimnis überein", async ({ page, request }, info) => {
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  await allowLoopbackTargets(request);
  const received: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
  const receiver = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const port = (receiver.address() as net.AddressInfo).port;
  try {
    await page.goto("/admin/api/webhooks/new");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(uniqueName(info, "Hook"));
    await page.getByRole("textbox", { name: "Adresse (URL)" }).fill(`http://127.0.0.1:${port}/hook`);
    await page.getByRole("checkbox", { name: /Ziel im eigenen Netz erlauben/ }).check();
    await page.getByRole("checkbox", { name: /Auftrag angelegt/ }).check();
    await confirm(page, "Passwort (zur Bestätigung)");
    await page.getByRole("button", { name: "Webhook anlegen" }).click();
    await expect(page.getByRole("heading", { name: "Webhook angelegt" })).toBeVisible();
    await page.getByRole("button", { name: "Anzeigen", exact: true }).click();
    const secret = await page.getByRole("textbox", { name: "Geheimnis der Signatur" }).inputValue();
    expect(secret.length).toBeGreaterThan(20);

    await page.getByRole("link", { name: "Zum Webhook" }).click();
    await page.getByRole("button", { name: "Test-Ereignis senden" }).click();
    await expect(page.getByText(/Zugestellt: Antwort 200/)).toBeVisible({ timeout: 30_000 });

    expect(received).toHaveLength(1);
    const { headers, body } = received[0];
    const event = JSON.parse(body) as { type?: string; id?: string };
    expect(event.type).toBe("webhook.test");
    // Signatur v1 nachrechnen: HMAC-SHA256(secret, "<Zeitstempel>.<Ereignis-ID>.<Body>")
    const timestamp = String(headers["x-webhook-timestamp"]);
    const id = String(headers["x-webhook-id"]);
    const expected = createHmac("sha256", secret).update(`${timestamp}.${id}.${body}`).digest("hex");
    expect(String(headers["x-webhook-signature"])).toContain(`v1=${expected}`);
    expect(body, "kein Klartext von Fachdaten in der Nutzlast").not.toMatch(/Kunde|Erika|Musterstraße/);
  } finally {
    await new Promise((resolve) => receiver.close(resolve));
  }
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});

/** Beide Tests legen den Tresor an bzw. sperren ihn – der Zustand liegt im Speicher des einen Servers, deshalb nie gleichzeitig (ein Worker, feste Reihenfolge). */
test.describe.serial("IT-Tresor", () => {
  test("IT-Tresor: Eintrag anlegen, Zugangsdaten nie in Liste und Seite, Anzeige nur mit Passwort und nach 30 Sekunden wieder verborgen, no-store", async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const browserErrors = collectBrowserErrors(page);
    await watchCsp(page);
    const title = uniqueName(info, "Firewall");
    const secretText = `Geheim-${Date.now().toString(36)}-xyz`;

    await ensureVaultUnlocked(page);
    await page.goto("/docs/vault/new");
    await expect(page.getByRole("textbox", { name: "Titel" })).toBeVisible(); // die Seite streamt: erst messen, wenn das Formular da ist
    // Struktur gegen Passwortmanager: keine Felder namens username/password für die Zugangsdaten, kein type="password" für das Geheimnis, autocomplete aus
    const fields = await page.evaluate(() => [...document.querySelectorAll("main input, main textarea")].map((el) => ({ name: el.getAttribute("name") ?? "", type: el.getAttribute("type"), autocomplete: el.getAttribute("autocomplete") })));
    const secretField = fields.find((field) => field.name.includes("secret"));
    expect(secretField, "Feld für das Geheimnis").toBeTruthy();
    expect(secretField!.type).not.toBe("password");
    expect(secretField!.autocomplete).toBe("off");
    expect(fields.filter((field) => field.type === "password"), "kein Passwortfeld im Eintragsformular").toHaveLength(0);
    expect(fields.filter((field) => /^(username|password)$/.test(field.name))).toHaveLength(0);

    await page.getByRole("textbox", { name: "Titel" }).fill(title);
    await page.getByRole("textbox", { name: "System" }).fill("fw-e2e");
    await page.getByRole("textbox", { name: "Adresse (URL)" }).fill("https://fw.example.org");
    await page.getByRole("textbox", { name: "Benutzername" }).fill("admin-e2e");
    await page.getByRole("textbox", { name: "Passwort / Geheimnis" }).fill(secretText);
    await save(page);
    await page.waitForURL((url) => /^\/docs\/vault\/(?!new$)[^/]+$/.test(url.pathname));
    const detailUrl = page.url();

    // Seite und Liste: nichts von den Zugangsdaten; Köpfe: nie zwischenspeichern
    const detail = await request.get(detailUrl);
    expect(detail.headers()["cache-control"] ?? "").toContain("no-store");
    expect(await detail.text()).not.toContain(secretText);
    await page.goto("/docs/vault");
    await expect(page.locator("a:visible", { hasText: title }).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText(secretText);

    // Anzeige mit dem richtigen Passwort zeigt die Werte. Die Uhr des Browsers läuft ab hier unter Kontrolle (Z6-4 L-4): „nach 30 Sekunden wieder verborgen“ wird vorgespult statt abgewartet
    await page.clock.install();
    await page.goto(detailUrl);
    await page.getByRole("textbox", { name: "Passwort" }).first().fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Zugangsdaten anzeigen" }).click();
    await expect(page.getByText("admin-e2e")).toBeVisible();
    await expect(page.getByText("https://fw.example.org")).toBeVisible();
    const masked = page.getByRole("textbox", { name: "Passwort / Geheimnis" });
    await expect(masked, "das Geheimnis bleibt verdeckt, bis man „Anzeigen“ wählt").toHaveValue("Verborgen");
    await page.getByRole("button", { name: "Anzeigen", exact: true }).click();
    await expect(masked).toHaveValue(secretText);

    // nach 30 Sekunden sind die Werte wieder verborgen (Uhr des Browsers vorspulen statt zu warten)
    await page.clock.fastForward(31_000);
    await expect(page.getByText("admin-e2e")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(secretText);
    await expect(page.getByText("Die Zugangsdaten sind wieder verborgen.")).toBeVisible();

    // mit falschem Passwort zeigt die Anwendung nichts (zuletzt: ein Fehlversuch bremst weitere Eingaben)
    await page.goto(detailUrl);
    await page.getByRole("textbox", { name: "Passwort" }).first().fill("falsches-Passwort-123");
    await page.getByRole("button", { name: "Zugangsdaten anzeigen" }).click();
    await expect(page.getByText("Das aktuelle Passwort ist falsch.").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("admin-e2e");
    expect(await cspViolations(page)).toEqual([]);
    expect(browserErrors()).toEqual([]);
  });

  test("IT-Tresor: nach dem Sperren (Neustart) nichts lesbar, falsche Passphrase abgewiesen, richtige entsperrt wieder", async ({ page }, info) => {
    test.setTimeout(120_000);
    const browserErrors = collectBrowserErrors(page);
    await watchCsp(page);
    await ensureVaultUnlocked(page);
    const title = uniqueName(info, "Router");
    await page.goto("/docs/vault/new");
    await page.getByRole("textbox", { name: "Titel" }).fill(title);
    await page.getByRole("textbox", { name: "Passwort / Geheimnis" }).fill("Router-Pw-e2e-1");
    await save(page);
    await page.waitForURL((url) => /^\/docs\/vault\/(?!new$)[^/]+$/.test(url.pathname));
    const detailUrl = page.url();

    // sperren: der Eintrag lässt sich nicht mehr anzeigen, die Seite verweist auf das Entsperren
    await page.goto("/docs/vault");
    await page.getByRole("button", { name: "Tresor sperren" }).click();
    await expect(page.getByRole("button", { name: "Tresor entsperren", exact: true })).toBeVisible();
    await page.goto(detailUrl);
    await expect(page.getByText("Der Tresor ist gesperrt").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Zugangsdaten anzeigen" })).toHaveCount(0);

    // falsche Passphrase: abgewiesen, der Tresor bleibt gesperrt
    await page.goto("/docs/vault");
    await page.getByLabel("Tresor-Passphrase").fill("das-ist-die-falsche-Passphrase-1");
    await page.getByLabel("Eigenes Passwort (zur Bestätigung)").first().fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Tresor entsperren", exact: true }).click();
    await expect(page.getByText("Die Passphrase ist falsch.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tresor sperren" })).toHaveCount(0);

    // richtige Passphrase: entsperrt, Anzeige geht wieder
    await page.getByLabel("Tresor-Passphrase").fill(VAULT_PASSPHRASE);
    await page.getByLabel("Eigenes Passwort (zur Bestätigung)").first().fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Tresor entsperren", exact: true }).click();
    await expect(page.getByRole("button", { name: "Tresor sperren" })).toBeVisible();
    await page.goto(detailUrl);
    await page.getByRole("textbox", { name: "Passwort" }).first().fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Zugangsdaten anzeigen" }).click();
    await expect(page.getByRole("button", { name: "Ausblenden" })).toBeVisible();
    expect(await cspViolations(page)).toEqual([]);
    expect(browserErrors()).toEqual([]);
  });

  test("IT-Tresor: Passphrase ändern verlangt die bisherige Passphrase; ohne Hülle für den Wiederherstellungsschlüssel warnt die Seite und das Anlegen lehnt einen fehlenden Schlüssel ab", async ({ page }) => {
    test.setTimeout(150_000);
    const browserErrors = collectBrowserErrors(page);
    await watchCsp(page);
    await ensureVaultUnlocked(page);
    const NEW_PASSPHRASE = "E2E-Neue-Tresor-Passphrase für den Browsertest 2027";

    // ohne Hülle für den Wiederherstellungsschlüssel: Warnung, Verweis in die Verwaltung und das Formular zum Hinterlegen
    await page.goto("/docs/vault");
    await expect(page.getByText(/Der Wiederherstellungsschlüssel öffnet diesen Tresor noch nicht/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Wiederherstellungsschlüssel einrichten" })).toBeVisible();
    const wrap = page.getByRole("heading", { name: "Wiederherstellungsschlüssel hinterlegen" });
    await expect(wrap).toBeVisible();
    // es gibt (noch) keinen Wiederherstellungsschlüssel: das Anlegen der Hülle wird mit klarer Meldung abgelehnt
    await page.getByLabel("Wiederherstellungsschlüssel", { exact: true }).fill("ABCD-EFGH");
    await page.getByLabel("Eigenes Passwort (zur Bestätigung)").nth(0).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Wiederherstellungsschlüssel hinterlegen" }).click();
    await expect(page.getByText("Es gibt noch keinen Wiederherstellungsschlüssel.", { exact: false }).first()).toBeVisible();

    // Passphrase ändern: eine falsche bisherige Passphrase wird abgewiesen, die Hülle bleibt
    await page.goto("/docs/vault");
    const change = page.getByRole("button", { name: "Passphrase ändern", exact: true });
    await page.getByText("Passphrase ändern", { exact: true }).first().click();
    const form = page.locator("form").filter({ has: change });
    await form.getByLabel("Bisherige Passphrase").fill("das-ist-nicht-die-bisherige-Passphrase");
    await form.getByLabel("Tresor-Passphrase").fill(NEW_PASSPHRASE);
    await form.getByLabel("Passphrase wiederholen").fill(NEW_PASSPHRASE);
    await form.getByLabel("Eigenes Passwort (zur Bestätigung)").fill(TEST_PASSWORD);
    await change.click();
    await expect(page.getByText("Die Passphrase ist falsch.", { exact: true })).toBeVisible();

    // mit der richtigen bisherigen Passphrase gelingt es; nach dem Sperren öffnet nur die neue
    await form.getByLabel("Bisherige Passphrase").fill(VAULT_PASSPHRASE);
    await form.getByLabel("Tresor-Passphrase").fill(NEW_PASSPHRASE);
    await form.getByLabel("Passphrase wiederholen").fill(NEW_PASSPHRASE);
    await form.getByLabel("Eigenes Passwort (zur Bestätigung)").fill(TEST_PASSWORD);
    await change.click();
    await expect(page.getByText("Passphrase geändert.")).toBeVisible();
    await page.getByRole("button", { name: "Tresor sperren" }).click();
    await expect(page.getByRole("button", { name: "Tresor entsperren", exact: true })).toBeVisible();
    await page.getByLabel("Tresor-Passphrase").fill(VAULT_PASSPHRASE);
    await page.getByLabel("Eigenes Passwort (zur Bestätigung)").first().fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Tresor entsperren", exact: true }).click();
    await expect(page.getByText("Die Passphrase ist falsch.", { exact: true })).toBeVisible();
    await page.getByLabel("Tresor-Passphrase").fill(NEW_PASSPHRASE);
    await page.getByLabel("Eigenes Passwort (zur Bestätigung)").first().fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Tresor entsperren", exact: true }).click();
    await expect(page.getByRole("button", { name: "Tresor sperren" })).toBeVisible();

    // zurück zur Passphrase der übrigen Fälle (mit der gerade gesetzten als Nachweis)
    await page.getByText("Passphrase ändern", { exact: true }).first().click();
    const back = page.locator("form").filter({ has: page.getByRole("button", { name: "Passphrase ändern", exact: true }) });
    await back.getByLabel("Bisherige Passphrase").fill(NEW_PASSPHRASE);
    await back.getByLabel("Tresor-Passphrase").fill(VAULT_PASSPHRASE);
    await back.getByLabel("Passphrase wiederholen").fill(VAULT_PASSPHRASE);
    await back.getByLabel("Eigenes Passwort (zur Bestätigung)").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Passphrase ändern", exact: true }).click();
    await expect(page.getByText("Passphrase geändert.")).toBeVisible();
    expect(await cspViolations(page)).toEqual([]);
    expect(browserErrors()).toEqual([]);
  });
});

test("Dienstkonto: Schlüssel mit begrenzter und mit unbegrenzter Laufzeit, jeder Schlüssel einzeln widerrufbar, „unbegrenzt“ nur für Dienstkonten", async ({ page, playwright, baseURL }, info) => {
  test.setTimeout(120_000);
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  const account = uniqueName(info, "Dienstkonto");
  await page.goto("/admin/api/accounts/new");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(account);
  for (const box of await page.locator('input[name="roleId"]').all()) await box.check({ force: true });
  await confirm(page, "Passwort (zur Bestätigung)");
  await page.getByRole("button", { name: "Dienstkonto anlegen" }).click();
  await page.waitForURL((url) => url.pathname === "/admin/api/accounts");

  const issue = async (name: string, expiry: string) => {
    await page.goto("/admin/api/tokens/new");
    await page.getByLabel("Besitzer").selectOption({ label: `${account} (Dienstkonto)` });
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await page.getByLabel("Gültig für").selectOption(expiry);
    await page.getByRole("checkbox", { name: /^Termine ansehen/ }).check();
    await confirm(page, "Eigenes Passwort");
    await page.getByRole("button", { name: "Token anlegen" }).click();
    await expect(page.getByRole("heading", { name: "Token angelegt" })).toBeVisible();
    await page.getByRole("button", { name: "Anzeigen", exact: true }).click();
    return page.getByRole("textbox", { name: "API-Token (Klartext)" }).inputValue();
  };
  const timedName = uniqueName(info, "befristet");
  const foreverName = uniqueName(info, "unbegrenzt");
  const timed = await issue(timedName, "30");
  await expect(page.getByText(/gilt bis/)).toBeVisible();
  const forever = await issue(foreverName, "unlimited");
  await expect(page.getByText("keinen Ablauf")).toBeVisible();

  // Ohne Dienstkonto als Besitzer gibt es „Unbegrenzt“ nicht
  await page.goto("/admin/api/tokens/new");
  await expect(page.getByLabel("Gültig für").locator('option[value="unlimited"]')).toHaveCount(0);

  const call = async (token: string) => {
    const api = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
    const status = (await api.get("/api/v1/appointments")).status();
    await api.dispose();
    return status;
  };
  expect(await call(timed)).toBe(200);
  expect(await call(forever)).toBe(200);

  // Liste: der unbegrenzte Schlüssel steht als „ohne Ablauf“; einzeln widerrufen, der andere bleibt gültig
  await page.goto("/admin/api");
  const row = page.getByRole("row").filter({ hasText: foreverName });
  await expect(row).toContainText("ohne Ablauf");
  await row.getByRole("button").first().click();
  await page.getByRole("dialog").getByRole("button").last().click();
  await expect.poll(() => call(forever), { timeout: 15_000 }).toBe(401);
  expect(await call(timed), "die anderen Schlüssel des Kontos bleiben").toBe(200);
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});

test("Überwachung: Ziel gegen einen lokalen Port anlegen, die Messung zeigt „erreichbar“ – danach „nicht erreichbar“, wenn der Port schließt", async ({ page, request }, info) => {
  test.setTimeout(480_000);
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  await allowLoopbackTargets(request);
  const target = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  const port = (target.address() as net.AddressInfo).port;
  const name = uniqueName(info, "Ziel");
  let switchedOn = false;
  try {
    await page.goto("/network/monitoring/new");
    await page.getByRole("textbox", { name: "Bezeichnung" }).fill(name);
    await page.getByRole("textbox", { name: "Host oder IP-Adresse" }).fill("127.0.0.1");
    await page.getByRole("spinbutton", { name: "Port" }).fill(String(port));
    await page.getByLabel("Prüfintervall").selectOption({ label: "1 Minute" });
    await save(page);
    await page.waitForURL((url) => /^\/network\/monitoring\/(?!new$)[^/]+$/.test(url.pathname));
    const detailUrl = page.url();

    // Überwachung einschalten (Schalter auf der Liste); der Job läuft alle 30 s und prüft fällige Ziele
    await page.goto("/network/monitoring");
    const toggle = page.getByRole("switch", { name: "Überwachung" });
    if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
    switchedOn = true;
    await expect(page.getByRole("switch", { name: "Überwachung" })).toHaveAttribute("aria-checked", "true");

    await expect
      .poll(async () => {
        await page.goto(detailUrl);
        return (await page.locator("main").innerText()).includes("Erreichbar");
      }, { timeout: 180_000, intervals: [5_000], message: "das Ziel wird als erreichbar gemessen" })
      .toBe(true);

    // Port schließen: der nächste Lauf meldet den Ausfall
    await new Promise((resolve) => target.close(resolve));
    await expect
      .poll(async () => {
        await page.goto(detailUrl);
        return /Nicht erreichbar|Ausgefallen|Offline/.test(await page.locator("main").innerText());
      }, { timeout: 240_000, intervals: [10_000], message: "der Ausfall wird gemessen (zwei Fehlschläge in Folge, Wiederholung nach kurzer Pause)" })
      .toBe(true);
  } finally {
    if (target.listening) await new Promise((resolve) => target.close(resolve));
    if (switchedOn) {
      await page.goto("/network/monitoring");
      const toggle = page.getByRole("switch", { name: "Überwachung" });
      if ((await toggle.getAttribute("aria-checked")) === "true") await toggle.click();
    }
  }
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});

test("Kalender-Abo: Abo-Adresse mit Passwortabfrage erzeugen, der Kalender lässt sich ohne Sitzung abrufen, eine geänderte Adresse nicht", async ({ page, playwright, baseURL }) => {
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  await page.goto("/appointments/feed");
  await page.locator("#feed-create-password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /Abo-Adresse erzeugen|Neue Adresse erzeugen/ }).click();
  const field = page.getByRole("textbox", { name: "Abo-Adresse (geheim halten)" });
  await expect(field).toHaveValue("Verborgen");
  await page.getByRole("button", { name: "Anzeigen", exact: true }).click();
  const feedUrl = await field.inputValue();
  expect(feedUrl).toMatch(/^https?:\/\/[^/]+\/api\/ical\//);

  // Der Kalender-Dienst des Handys hat keine Sitzung: Abruf nur mit der Adresse
  const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const feed = await anonymous.get(new URL(feedUrl).pathname);
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toContain("text/calendar");
  const ics = await feed.text();
  expect(ics).toMatch(/^BEGIN:VCALENDAR/);
  expect(ics).toContain("BEGIN:VEVENT");
  expect(ics).toMatch(/END:VCALENDAR\s*$/);
  // eine geänderte Adresse ist keine Adresse
  const broken = new URL(feedUrl).pathname.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  expect([401, 404]).toContain((await anonymous.get(broken)).status());

  // Widerruf: die Adresse liefert danach nichts mehr
  await page.reload();
  await page.locator("#feed-revoke-password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Abo widerrufen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Abo widerrufen" }).click();
  await expect.poll(async () => (await anonymous.get(new URL(feedUrl).pathname)).status(), { timeout: 15_000 }).toBe(401);
  await anonymous.dispose();
  expect(await cspViolations(page)).toEqual([]);
  expect(browserErrors()).toEqual([]);
});
