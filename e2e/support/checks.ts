import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/**
 * Die Prüfungen der Browser-CI. Jede liefert eine Liste stabiler Kennungen (kein Text, keine Zahlen), damit die Baseline-Listen
 * (e2e/baselines/known-violations.json) über Läufe hinweg gleich bleiben.
 */

/** Muss vor `goto` aufgerufen werden: sammelt `securitypolicyviolation`-Ereignisse der Seite. */
export async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`.slice(0, 160)));
  });
}
export const cspViolations = (page: Page) => page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);

/** Elemente, die rechts/links über den Bildschirm hinausragen (Elementrechte, nicht `scrollWidth`); in Scroll-Containern oder unsichtbar zählt nicht. */
export function findOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${[...el.classList]
        .slice(0, 3)
        .map((c) => "." + c)
        .join("")}`;
    const out = new Set<string>();
    for (const el of document.body.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest("[inert],[hidden],[aria-hidden='true'],svg")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || (r.right <= width + 1 && r.left >= -1)) continue;
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") {
          const pr = p.getBoundingClientRect();
          if (pr.right <= width + 1 && pr.left >= -1) {
            clipped = true;
            break;
          }
        }
      }
      if (!clipped) out.add(describe(el));
    }
    return [...out].sort();
  });
}

/** Bedienelemente, die kleiner als 44 × 44 px sind (nur bei Touch); Fließtext-Links und die Label-Fläche von Checkboxen zählen anders. */
export function findSmallTargets(page: Page, min = 44): Promise<string[]> {
  return page.evaluate((min) => {
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${[...el.classList]
        .slice(0, 3)
        .map((c) => "." + c)
        .join("")}`;
    const out = new Set<string>();
    const selector = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=menuitem], [role=tab], [role=option]";
    for (const el of document.querySelectorAll(selector)) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest("[inert],[hidden],[aria-hidden='true']")) continue;
      if ((el as HTMLButtonElement).disabled) continue;
      if (el.tagName === "A" && style.display === "inline") continue; // Link im Fließtext
      if (el.classList.contains("sr-only") || el.closest(".sr-only")) continue;
      // Checkbox/Radio: Ziel ist das umschließende Label
      const target = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? (el.closest("label") ?? el) : el;
      const r = target.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width < min - 0.5 || r.height < min - 0.5) out.add(describe(el));
    }
    return [...out].sort();
  }, min);
}

/** Eingabefelder mit Schrift unter 16 px (iOS zoomt beim Fokus hinein). */
export function findSmallInputFont(page: Page, min = 16): Promise<string[]> {
  return page.evaluate((min) => {
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${[...el.classList]
        .slice(0, 3)
        .map((c) => "." + c)
        .join("")}`;
    const skip = new Set(["hidden", "checkbox", "radio", "range", "color", "file", "button", "submit", "image", "reset"]);
    const out = new Set<string>();
    for (const el of document.querySelectorAll("input, textarea, select")) {
      // Attribut statt Eigenschaft: WebKit ohne Farbwähler meldet type="color" als "text"
      if (el instanceof HTMLInputElement && skip.has((el.getAttribute("type") ?? "text").toLowerCase())) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest("[inert],[hidden],[aria-hidden='true']")) continue;
      if (parseFloat(style.fontSize) < min - 0.01) out.add(describe(el));
    }
    return [...out].sort();
  }, min);
}

/**
 * Wartet, bis Layout und Farben (nach einem Wechsel von Hell/Dunkel, Schriften, Animationen) zur Ruhe gekommen sind – sonst messen axe und Co. Zwischenzustände.
 * Statt einer festen Wartezeit: Schriften, zwei Frames, dann alle laufenden Animationen und Übergänge (höchstens eine Sekunde; Endlosanimationen enden nie).
 */
export async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const running = Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
            void Promise.race([running, new Promise((done) => setTimeout(done, 1000))]).then(() => requestAnimationFrame(() => resolve()));
          }),
        );
      }),
  );
}

/** axe-core (WCAG 2 A/AA): Kennungen der verletzten Regeln. */
export async function axeRules(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.map((v) => v.id).sort();
}
