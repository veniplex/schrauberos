import { expect, test, request } from "@playwright/test";
import { DEFAULT_ROLES } from "../../src/modules/default-roles";
import { BASE_URL, ROLE_KEYS, authFile } from "../support/env";
import { loadInventory } from "../support/inventory";

/**
 * Rechte je Standardrolle über die ganze Routen-Inventur: Wer das Recht hat, sieht die Seite. Wer es nicht hat, wird auf „Kein Zugriff“
 * (/forbidden) geleitet; eine ausgeschaltete Funktion gibt es schlicht nicht (404, im Test nicht vorkommend). Geprüft wird die Antwort selbst,
 * ohne Browser (schnell): Weil die Ladeseite zuerst gesendet wird, steht der Statuscode schon auf 200, die Weiterleitung steckt dann in einem
 * Meta-Tag (`__next-page-redirect`), „nicht gefunden“ in einem zusätzlichen `noindex`-Tag. Läuft einmal (Desktop-Projekt); der Administrator
 * ist durch inventory.spec.ts abgedeckt.
 */
// Dialoge (?new=1 …) öffnen sich nur mit dem Recht, die Seite dahinter bleibt für alle mit Leserecht sichtbar: sie gehören nicht in diese Prüfung
const entries = loadInventory().filter((e) => !e.public && e.kind !== "modal");
const permissionsOf = (role: string) => new Set<string>(DEFAULT_ROLES.find((r) => r.key === role)?.permissions ?? []);

type Outcome = "sichtbar" | "gesperrt" | "nicht gefunden";
function outcomeOf(status: number, body: string): Outcome {
  if (status >= 300 && status < 400) return "gesperrt"; // klassische Weiterleitung
  if (/<meta[^>]*id="__next-page-redirect"[^>]*\/forbidden|<meta[^>]*\/forbidden[^>]*id="__next-page-redirect"/.test(body)) return "gesperrt";
  if (status === 404 || /<meta name="robots" content="noindex"\/?>/.test(body)) return "nicht gefunden";
  return "sichtbar";
}

for (const role of ROLE_KEYS.filter((r) => r !== "admin")) {
  test(`Rolle ${role}: Zugriff auf alle Seiten der Inventur`, async ({}, info) => {
    test.skip(info.project.name !== "desktop", "Rechte hängen nicht von der Anzeigegröße ab");
    const api = await request.newContext({ baseURL: BASE_URL, storageState: authFile(role) });
    const permissions = permissionsOf(role);
    const wrong: string[] = [];
    try {
      for (const entry of entries) {
        const allowed = entry.permission === null || permissions.has(entry.permission);
        const res = await api.get(entry.url, { maxRedirects: 0 });
        const outcome = outcomeOf(res.status(), await res.text());
        if (allowed && outcome !== "sichtbar") wrong.push(`${entry.key}: erwartet sichtbar, war ${outcome}`);
        if (!allowed && outcome !== "gesperrt") wrong.push(`${entry.key}: erwartet gesperrt (${entry.permission}), war ${outcome}`);
      }
    } finally {
      await api.dispose();
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
