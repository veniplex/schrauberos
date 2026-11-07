import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/** Leistung auf schwachen Handys (P3-6): keine Hintergrundunschärfe außer auf großen Bildschirmen ohne „reduzierte Transparenz“. */
const SRC = path.resolve(process.cwd(), "src");
const globals = readFileSync(path.join(SRC, "app", "globals.css"), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "generated") return [];
    return statSync(full).isDirectory() ? walk(full) : /\.(tsx|css)$/.test(name) ? [full] : [];
  });

describe("Hintergrundunschärfe", () => {
  it("kein `backdrop-blur`/`backdrop-filter` im Code außer in der Klasse `glass-bar`", () => {
    const offenders = walk(SRC).filter((file) => /backdrop-(blur|filter)/.test(readFileSync(file, "utf8")) && !file.endsWith("globals.css"));
    assert.deepEqual(offenders.map((f) => path.relative(SRC, f)), []);
    assert.equal(globals.match(/backdrop-filter:/g)?.length, 1, "genau eine Stelle");
  });

  it("`glass-bar` ist standardmäßig deckend; Unschärfe und Durchsicht nur ab 1024 px und ohne prefers-reduced-transparency", () => {
    assert.match(globals, /\.glass-bar \{\s*background: var\(--glass, var\(--surface\)\);\s*\}/);
    const guarded = /@media \(min-width: 1024px\) and \(prefers-reduced-transparency: no-preference\) \{\s*\.glass-bar \{([^}]*)\}/.exec(globals);
    assert.ok(guarded, "geschützter Block fehlt");
    assert.match(guarded[1], /backdrop-filter: blur\(/);
    assert.match(guarded[1], /color-mix\(/);
  });

  it("die klebenden Leisten (Kopfzeilen, Kalender-Tageskopf) tragen `glass-bar`", () => {
    const sidebar = readFileSync(path.join(SRC, "components", "shell", "sidebar.tsx"), "utf8");
    const calendar = readFileSync(path.join(SRC, "modules", "workshop", "appointments", "calendar.tsx"), "utf8");
    assert.equal(sidebar.match(/glass-bar/g)?.length, 2);
    assert.equal(calendar.match(/glass-bar/g)?.length, 2);
  });
});
