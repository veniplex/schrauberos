import Database from "better-sqlite3";
import { chromium } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { scryptHash } from "../src/server/auth/scrypt";
import { ADMIN_USER, AUTH_DIR, BASE_URL, DATA_DIR, DB_FILE, FOUND_DIR, ROLE_KEYS, TEST_PASSWORD, authFile, userOf, type RoleKey } from "./support/env";

/**
 * Richtet die frisch gestartete App ein – so, wie es ein Anwender tut: Ersteinrichtung im Browser mit dem Einrichtungs-Token, das die App
 * beim Start in die Datei `setup-token` im Datenverzeichnis schreibt (Beispieldaten an). Danach legt das Setup je Standardrolle ein Konto an
 * (direkt in der Datenbank, mit echtem Passwort-Hash) und meldet jedes Konto im Browser an; die Sitzungen liegen in e2e/.auth/<rolle>.json.
 */
export default async function globalSetup() {
  rmSync(FOUND_DIR, { recursive: true, force: true });
  rmSync(AUTH_DIR, { recursive: true, force: true });
  mkdirSync(AUTH_DIR, { recursive: true });

  const tokenFile = path.join(DATA_DIR, "setup-token");
  if (!existsSync(tokenFile)) throw new Error(`Einrichtungs-Token fehlt (${tokenFile}): Die App hat eine frische Datenbank erwartet.`);
  const token = readFileSync(tokenFile, "utf8").trim();

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, locale: "de-DE", timezoneId: "Europe/Berlin" });
    const page = await context.newPage();
    await page.goto("/setup");
    await page.locator("#token").fill(token);
    await page.locator("#workshopName").fill("E2E-Werkstatt");
    await page.locator("#name").fill("E2E Administrator");
    await page.locator("#username").fill(ADMIN_USER);
    await page.locator("#password").fill(TEST_PASSWORD);
    await page.locator("#confirm").fill(TEST_PASSWORD);
    await page.locator('input[name="demo"]').check({ force: true });
    await page.getByRole("button", { name: "Einrichtung abschließen" }).click();
    // Danach zeigt die Einrichtung den Wiederherstellungs-Code (Pflicht-Bestätigung); angemeldet ist das Konto bereits
    await page.getByText("Ich habe den Code gesichert.").first().waitFor({ timeout: 60_000 });
    await context.storageState({ path: authFile("admin") });
    await context.close();

    // Konten für die übrigen Standardrollen (Rollen entstehen beim Start der App)
    const db = new Database(DB_FILE);
    try {
      const hash = await scryptHash(TEST_PASSWORD);
      const now = new Date().toISOString().replace("Z", "+00:00");
      for (const key of ROLE_KEYS.filter((k) => k !== "admin")) {
        const role = db.prepare(`SELECT id FROM "Role" WHERE key = ?`).get(key) as { id: string } | undefined;
        if (!role) throw new Error(`Standardrolle ${key} fehlt`);
        const id = `e2e${randomBytes(8).toString("hex")}`;
        db.prepare(`INSERT INTO "User" (id, username, name, passwordHash, active, mustChangePassword, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, 0, ?, ?)`).run(id, userOf(key), `E2E ${key}`, hash, now, now);
        db.prepare(`INSERT INTO "UserRole" (userId, roleId) VALUES (?, ?)`).run(id, role.id);
      }
    } finally {
      db.close();
    }

    for (const role of ROLE_KEYS.filter((k): k is Exclude<RoleKey, "admin"> => k !== "admin")) {
      const ctx = await browser.newContext({ baseURL: BASE_URL, locale: "de-DE" });
      const p = await ctx.newPage();
      await p.goto("/login");
      await p.locator("#username").fill(userOf(role));
      await p.locator("#password").fill(TEST_PASSWORD);
      await p.locator('button[type="submit"]').click();
      await p.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
      await ctx.storageState({ path: authFile(role) });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}
