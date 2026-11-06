import { expect, test, request } from "@playwright/test";
import { DEFAULT_ROLES } from "../../src/modules/default-roles";
import { BASE_URL, ROLE_KEYS, authFile } from "../support/env";
import { loadInventory } from "../support/inventory";

/**
 * Rechte je Standardrolle über die ganze Routen-Inventur: Wer das Recht hat, sieht die Seite, alle anderen sehen „Seite nicht gefunden“
 * (nicht das Gerüst der Seite). Geprüft wird im Browser auf der fertig gestreamten Seite – der Statuscode allein taugt nicht, weil die
 * Ladeseite zuerst gesendet wird (200) und „nicht gefunden“ erst danach feststeht. Läuft einmal (Desktop-Projekt); der Administrator ist
 * durch inventory.spec.ts abgedeckt.
 */
const entries = loadInventory().filter((e) => !e.public);
const permissionsOf = (role: string) => new Set<string>(DEFAULT_ROLES.find((r) => r.key === role)?.permissions ?? []);

for (const role of ROLE_KEYS.filter((r) => r !== "admin")) {
  test(`Rolle ${role}: Zugriff auf alle Seiten der Inventur`, async ({ browser }, info) => {
    test.skip(info.project.name !== "desktop", "Rechte hängen nicht von der Anzeigegröße ab");
    const context = await browser.newContext({ storageState: authFile(role), baseURL: BASE_URL, locale: "de-DE" });
    const page = await context.newPage();
    const permissions = permissionsOf(role);
    const wrong: string[] = [];
    try {
      for (const entry of entries) {
        const allowed = entry.permission === null || permissions.has(entry.permission);
        await page.goto(entry.url, { waitUntil: "load" });
        const notFound = (await page.locator("[data-status='not-found']").count()) > 0;
        if (allowed && notFound) wrong.push(`${entry.key}: erwartet sichtbar, war „nicht gefunden“`);
        if (!allowed && !notFound) wrong.push(`${entry.key}: erwartet gesperrt (${entry.permission}), war sichtbar`);
      }
    } finally {
      await context.close();
    }
    expect(wrong).toEqual([]);
  });
}

test("ohne Anmeldung leitet jede Seite der Inventur zur Anmeldung", async ({}, info) => {
  test.skip(info.project.name !== "desktop", "unabhängig von der Anzeigegröße");
  // Ausdrücklich ohne Sitzung (sonst gilt die Administrator-Sitzung aus der Konfiguration)
  const api = await request.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  try {
    const wrong: string[] = [];
    for (const entry of entries) {
      const res = await api.get(entry.url, { maxRedirects: 0 });
      if (res.status() < 300 || res.status() >= 400 || !(res.headers().location ?? "").includes("/login")) wrong.push(`${entry.key}: ${res.status()}`);
    }
    expect(wrong).toEqual([]);
  } finally {
    await api.dispose();
  }
});
