import { expect, type Page, type TestInfo } from "@playwright/test";
import { checkAgainstBaseline } from "./baseline";
import { axeRules, cspViolations, findOverflow, findSmallInputFont, findSmallTargets, settle, watchCsp } from "./checks";

/**
 * Gemeinsame Seitenprüfung der Browser-Tests: Fehlerseiten und Browserfehler erkennen, dann Überbreite, Touch-Ziele, Eingabeschrift, axe (Hell und Dunkel)
 * und Verstöße gegen die Content-Security-Policy – mit den Baseline-Listen bekannter Verstöße.
 */

/**
 * Sammelt Fehler des Browsers: nicht abgefangene Ausnahmen (`pageerror`) und `console.error`. Fehlgeschlagene Ressourcen („Failed to load resource“) zählen hier
 * nicht – dafür sorgt die Prüfung des Statuscodes. Muss vor `goto` aufgerufen werden; das Ergebnis liefert die Funktion.
 */
export function collectBrowserErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`.slice(0, 300)));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/i.test(message.text())) errors.push(`console.error: ${message.text()}`.slice(0, 300));
  });
  return () => [...errors];
}

/**
 * Wirft, wenn die Seite eine Fehlerseite zeigt (`data-status="error"`). Wegen `loading.tsx` steht der Statuscode schon auf 200, wenn der Fehler auftritt –
 * der Statuscode allein verrät eine Fehlerseite nicht. Wirft absichtlich (statt `expect.soft`), damit ein Test die Erkennung selbst prüfen kann.
 */
export async function assertNoErrorPage(page: Page, label: string): Promise<void> {
  const count = await page.locator("[data-status='error']").count();
  if (count > 0) throw new Error(`${label}: Fehlerseite statt Inhalt (data-status="error")`);
}

/** Im Antworttext einer Seite (ohne Browser): Fehlerseite oder von Next eingebettete Fehlerkennung (`data-dgst`, Fehler im gestreamten Teil). */
export const looksLikeErrorPage = (html: string) => /data-status="error"|\sdata-dgst="/.test(html);

export type PageCheckOptions = {
  /** Schlüssel in den Baseline-Listen (Seitenmuster) */
  key: string;
  /** Seite öffnet ein Dialogfenster */
  modal?: boolean;
};

/** Öffnet `url` und führt alle Prüfungen aus; Fehlerseiten und Browserfehler lassen den Test scheitern. */
export async function openAndCheck(page: Page, url: string, info: TestInfo, options: PageCheckOptions): Promise<void> {
  const touch = Boolean(info.project.use.hasTouch);
  const browserErrors = collectBrowserErrors(page);
  await watchCsp(page);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const response = await page.goto(url, { waitUntil: "load" });
  expect(response?.status(), `${url}: Statuscode`).toBe(200);
  await expect(page.locator("[data-status='not-found']"), `${url}: Seite nicht gefunden`).toHaveCount(0);
  await settle(page);
  await assertNoErrorPage(page, url);
  if (options.modal) await expect(page.locator("dialog[open]")).toBeVisible();

  await runPageChecks(page, info, options.key, touch);
  expect.soft(browserErrors(), `${options.key}: Fehler im Browser`).toEqual([]);
}

/** Die Prüfungen an der bereits geöffneten Seite (Überbreite, Touch, Schrift, axe hell/dunkel, CSP). */
export async function runPageChecks(page: Page, info: TestInfo, key: string, touch = Boolean(info.project.use.hasTouch)): Promise<void> {
  checkAgainstBaseline(info, "overflow", key, await findOverflow(page));
  if (touch) {
    checkAgainstBaseline(info, "touch", key, await findSmallTargets(page));
    checkAgainstBaseline(info, "font", key, await findSmallInputFont(page));
  }
  checkAgainstBaseline(info, "axe-light", key, await axeRules(page));
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await settle(page);
  checkAgainstBaseline(info, "axe-dark", key, await axeRules(page));
  expect.soft(await cspViolations(page), `${key}: Verstöße gegen die Content-Security-Policy`).toEqual([]);
}
