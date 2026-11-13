import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Einheitliches Datumsformat (Z6-5 N8): Überall vierstelliges Jahr. `dateStyle: "short"` liefert auf Deutsch „08.11.26“ (zweistelliges Jahr), „medium“ „08.11.2026“; Seiten mischten beides. Kein Aufruf darf
 * `short` für das Datum wählen (die Uhrzeit darf `timeStyle: "short"` heißen).
 */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === "generated" || name === "node_modules") continue;
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("Datumsformat", () => {
  it("deutsches „medium“ hat ein vierstelliges Jahr, „short“ ein zweistelliges (Grund der Regel)", () => {
    const at = new Date("2026-11-08T09:24:14Z");
    assert.match(new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC" }).format(at), /\.2026$/);
    assert.match(new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeZone: "UTC" }).format(at), /\.26$/);
  });

  it("kein Quelltext wählt dateStyle: short", () => {
    const offenders = sources(path.join(process.cwd(), "src")).filter((file) => /dateStyle:\s*["']short["']/.test(readFileSync(file, "utf8")));
    assert.deepEqual(offenders, []);
  });
});
