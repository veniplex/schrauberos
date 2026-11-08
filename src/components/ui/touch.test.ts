import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Touch-Fundament (RESP-01/02): Ziele mindestens 44 px und Eingabeschrift mindestens 16 px bei Touch (grober Zeiger) und unter 1024 px,
 * Desktop kompakt (36 px). Die Browser-CI prüft das am echten Layout (e2e/); dieser Test sichert die Quellen ab.
 */
const SRC = path.resolve(process.cwd(), "src");
const tokens = readFileSync(path.join(SRC, "app", "tokens.css"), "utf8");
const globals = readFileSync(path.join(SRC, "app", "globals.css"), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "generated" || name === "node_modules") return [];
    return statSync(full).isDirectory() ? walk(full) : /\.tsx$/.test(name) ? [full] : [];
  });
}

describe("Touch-Fundament", () => {
  it("Tokens: Desktop 36 px / 14 px, bei Touch und unter 1024 px 44 px / 16 px", () => {
    const base = /:root\s*\{[^}]*--tap:\s*36px;[^}]*--input-font:\s*0\.875rem;/;
    assert.match(tokens, base);
    const touch = /@media \(pointer: coarse\), \(max-width: 1023px\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(tokens);
    assert.ok(touch, "Media-Query für Touch fehlt in tokens.css");
    for (const token of ["--tap: 44px", "--tap-sm: 44px", "--tap-chip: 44px", "--tap-row: 44px", "--input-font: 1rem"]) assert.ok(touch[1].includes(token), `${token} fehlt`);
  });

  it("Button, Eingabefeld, Navigation, Menü, Umschalter und Chips nutzen die Tokens statt fester Höhen", () => {
    assert.match(globals, /\.btn\s*\{[^}]*min-h-\(--tap\)/);
    assert.match(globals, /\.btn-sm\s*\{[^}]*min-h-\(--tap-sm\)/);
    assert.match(globals, /\.input\s*\{[^}]*min-h-\(--tap\)[^}]*font-size:\s*var\(--input-font\)/);
    const ui = (file: string) => readFileSync(path.join(SRC, "components", "ui", file), "utf8");
    assert.match(ui("layout.tsx"), /min-h-\(--tap\) items-center gap-3/); // NavLink
    assert.match(ui("layout.tsx"), /badge[^"]*min-h-\(--tap-chip\)/); // ChipLink
    assert.match(ui("menu.tsx"), /min-h-\(--tap\) w-full/);
    assert.match(ui("segmented.tsx"), /min-h-\(--tap-sm\)/);
    // keine festen 32/36-px-Höhen mehr in den Bausteinen (außer dekorativen Platzhaltern)
    for (const file of ["buttons.tsx", "menu.tsx", "segmented.tsx", "form-fields.tsx"]) assert.doesNotMatch(ui(file), /\bmin-h-(8|9)\b|\bh-9\b/, `${file}: feste Höhe`);
  });

  it("Kennzeichen und FIN: Großbuchstaben ohne Autokorrektur; Zahlenfelder bekommen die Zahlentastatur", () => {
    const missing: string[] = [];
    let found = 0;
    for (const file of walk(SRC).filter((f) => !f.endsWith(".test.tsx"))) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/<Input[^>]*name="(plate|vin)"[^>]*\/?>/g)) {
        found++;
        if (!/autoCapitalize="characters"/.test(m[0]) || !/autoCorrect="off"/.test(m[0]) || !/spellCheck=\{false\}/.test(m[0])) missing.push(`${path.relative(SRC, file)}: ${m[1]}`);
      }
    }
    assert.ok(found >= 4, `Kennzeichen-/FIN-Felder gefunden: ${found}`);
    assert.deepEqual(missing, []);
    // Zahlentastatur und Fokus-Verhalten der Bausteine: Wiedergabetests in form.test.ts
  });

  it("kein Element der App setzt autoFocus an den Bausteinen vorbei (Verhalten selbst: form.test.ts)", () => {
    const direct = walk(SRC)
      .filter((f) => !f.includes(`${path.sep}ui${path.sep}`))
      .filter((f) => /<(textarea|select|button|input)\b[^>]*autoFocus/.test(readFileSync(f, "utf8")));
    assert.deepEqual(direct, []);
  });
});

describe("Touch-Feinschliff (P3-1)", () => {
  const ui = (file: string) => readFileSync(path.join(SRC, "components", "ui", file), "utf8");

  it("Kästchen: 24 px Fläche, ganze Zeile (Label) als Ziel", () => {
    assert.match(ui("form-fields.tsx"), /<label className=\{clsx\("flex min-h-\(--tap-row\) min-w-\(--tap-row\)[^"]*"[\s\S]{0,300}type="checkbox" className="size-6 /);
  });

  it("reduzierte Bewegung stoppt Spinner, Skeleton und Fortschrittsbalken", () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(globals);
    assert.ok(block, "Media-Query fehlt");
    assert.match(block[1], /\.animate-spin,\s*\.animate-pulse\s*\{\s*animation: none !important/);
    assert.match(block[1], /\.nav-progress::before\s*\{\s*animation: none !important/);
    assert.match(block[1], /animation-iteration-count: 1 !important/);
  });

  it("lange Wörter: Karten, Meldungen und Beschreibungen brechen überall, Tabellenzellen nur im Notfall (sonst schrumpften die Spalten)", () => {
    assert.match(globals, /\.card,\s*\.toast-viewport > \*,[\s\S]*?\{\s*overflow-wrap: anywhere;/);
    assert.match(globals, /\.table th,\s*\.table td,[\s\S]*?\{\s*overflow-wrap: break-word;/);
  });

  it("Safe-Area: Querformat-Aussparung seitlich, Toast, Blatt, Seitenfach und Aktionsleiste unten", () => {
    assert.match(globals, /body \{[^}]*padding-left: env\(safe-area-inset-left[^}]*padding-right: env\(safe-area-inset-right/);
    assert.match(globals, /\.toast-viewport \{[^}]*padding-left: max\(1rem, env\(safe-area-inset-left[^}]*safe-area-inset-bottom/);
    assert.match(globals, /dialog\.modal,\s*dialog\.modal\.confirm-dialog \{[^}]*padding-bottom: env\(safe-area-inset-bottom\)/);
    assert.match(globals, /dialog\.drawer \{[^}]*env\(safe-area-inset-bottom\) env\(safe-area-inset-left\)/);
    assert.match(globals, /\.form-actions \{[^}]*padding-bottom: max\(0\.75rem, env\(safe-area-inset-bottom\)\)/);
    const layout = readFileSync(path.join(SRC, "app", "layout.tsx"), "utf8");
    assert.match(layout, /viewportFit: "cover"/);
  });

  it("Detailseiten: Spalten des Rasters haben min-w-0 (eine breite Tabelle sprengt sonst die Handy-Spalte)", () => {
    const missing: string[] = [];
    for (const file of walk(path.join(SRC, "app")).filter((f) => /\[(id|subnetId)\]/.test(f) && f.endsWith("page.tsx"))) {
      const source = readFileSync(file, "utf8");
      const grid = source.indexOf('className="grid grid-cols-1 gap-5 md:grid-cols-3"');
      if (grid < 0) continue;
      const children = [...source.slice(grid).matchAll(/\n {8}<div className="([^"]*)">/g)].slice(0, 2);
      if (children.length < 2 || children.some((c) => !c[1].includes("min-w-0"))) missing.push(path.relative(SRC, file));
    }
    assert.deepEqual(missing, []);
  });
});
