import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { ALL_HELP_TOPICS } from "./help";

/**
 * Seitenkopf-Regeln (P2a-8), aus dem Quelltext der Seiten geprüft: Jede Detail-, Bearbeiten- und Neu-Seite führt zurück (`back`/`breadcrumbs` – ein installiertes
 * Web-App-Fenster hat keine Zurück-Taste), und jedes `help="…"` verweist auf ein Hilfekapitel, das es gibt.
 */
const APP = path.resolve(process.cwd(), "src/app/(app)");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : n === "page.tsx" ? [path.join(dir, n)] : []));
const pages = walk(APP).map((file) => ({ rel: path.relative(APP, file).split(path.sep).join("/"), source: readFileSync(file, "utf8") }));
const header = (source: string) => /<PageHeader[\s\S]*?\/>/.exec(source)?.[0] ?? "";

describe("Seitenkopf", () => {
  it("findet die Seiten (kein leerer Lauf)", () => {
    assert.ok(pages.length > 40);
  });

  it("Detail-, Bearbeiten- und Neu-Seiten haben back oder breadcrumbs", () => {
    // keine Detailseiten, obwohl der Pfad einen Parameter hat: Bereich der Dokumentation (Navigationsziel), Hilfekapitel (Teil der Hilfe), Testseiten
    const topLevel = new Set(["docs/[area]/page.tsx", "help/[slug]/page.tsx"]);
    const needs = pages.filter((p) => /(^|\/)(new|\[[a-zA-Z]+\])(\/|$)/.test(p.rel) && !/^e2e-state/.test(p.rel) && !topLevel.has(p.rel));
    assert.ok(needs.length >= 25);
    const missing = needs.filter((p) => !/\b(back|breadcrumbs)=/.test(header(p.source))).map((p) => p.rel);
    assert.deepEqual(missing, []);
  });

  it("help verweist auf ein vorhandenes Kapitel", () => {
    const platform = readdirSync(path.resolve(process.cwd(), "docs/platform")).map((f) => f.replace(/^\d+-/, "").replace(/\.md$/, ""));
    const known = new Set([...ALL_HELP_TOPICS.map((t) => t.id), ...platform]);
    const used = pages.flatMap((p) => [...p.source.matchAll(/\bhelp="([^"]+)"/g)].map((m) => ({ page: p.rel, id: m[1] })));
    assert.ok(used.length > 20);
    assert.deepEqual(used.filter((u) => !known.has(u.id)), []);
  });
});
