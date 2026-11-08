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
 * Statt einer festen Wartezeit: Schriften, dann Bild für Bild, bis drei Bilder lang keine endliche Animation oder Farbübergang mehr läuft (höchstens zwei Sekunden;
 * Endlosanimationen zählen nicht). Nicht einmalig „alle jetzt laufenden Animationen abwarten“: WebKit startet die Farbübergänge nach einem Wechsel von Hell/Dunkel erst
 * in den folgenden Bildern, und ein früher Blick sähe die Ausgangsfarben (axe meldete dann Kontrast 1,04 : 1).
 */
export async function settle(page: Page) {
  // Erst wenn die Skripte geladen sind und der Browser Luft hat (Hydration großer Seiten): Komponenten, die nach dem Einhängen messen (`ScrollArea`), setzen ihre Attribute erst dann
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const idle = (window as unknown as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => void }).requestIdleCallback;
        if (idle) idle(() => idle(() => resolve(), { timeout: 500 }), { timeout: 1000 });
        else setTimeout(resolve, 200); // WebKit kennt requestIdleCallback nicht
      }),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const started = performance.now();
        let calm = 0;
        const check = () => {
          const running = document.getAnimations().filter((animation) => {
            if (animation.playState !== "running") return false;
            const iterations = animation.effect?.getComputedTiming().iterations;
            return iterations !== Infinity;
          });
          calm = running.length === 0 ? calm + 1 : 0;
          if (calm >= 3 || performance.now() - started > 2000) resolve();
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
  );
}

/**
 * axe-core (WCAG 2 A/AA): Kennungen der verletzten Regeln.
 *
 * Ausnahme, eng gefasst: `target-size` an den Zeitfenster-Links des Terminkalenders (`[data-slot]`). Sie liegen unter den Terminkarten; wo parallele Termine ein Zeitfenster fast ganz
 * überdecken, bleibt nur ein schmaler Streifen sichtbar – berührbar ist dort ohnehin die Terminkarte, und neue Termine entstehen über „Neuer Termin“ und freie Zeitfenster. Alle anderen
 * Regeln und alle anderen Elemente prüft axe unverändert.
 */
export async function axeRules(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const ids = new Set<string>();
  for (const violation of result.violations) {
    const nodes = violation.id === "target-size" ? violation.nodes.filter((node) => !node.html.includes("data-slot")) : violation.nodes;
    if (nodes.length > 0) ids.add(violation.id);
  }
  return [...ids].sort();
}
