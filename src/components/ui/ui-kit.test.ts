import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Die Oberfläche besteht aus den Bausteinen in `src/components/ui`: Button, Input, Select, Checkbox, Table, Card …
 * Außerhalb davon gibt es keine rohen Formular-/Tabellen-/Aufklapp-Elemente und keine Klassen der Bausteine (`btn`, `input`, `card` …),
 * damit jede Änderung am Aussehen an einer Stelle erfolgt.
 *
 * Ausnahme für Module (`src/modules/**`) und Querschnittsfunktionen (`src/capabilities/**`): Eine Funktion darf für einen echten
 * Spezialfall ein eigenes Element mitbringen. Die Datei sagt das mit einem Kommentar `ui-kit-exception: <Grund>` ausdrücklich.
 *
 * Zusätzlich (P2a-5) gibt es keine nachgebauten Bausteine: Hinweisflächen (`Alert`/`StatusBadge` statt `bg-danger-bg` …), Reiter (`TabNav` statt `border-b-2`),
 * Links in Akzentfarbe (`TextLink`) und Tabellen ohne Beschriftung (`caption`). Bestehende Treffer stehen in `ALLOWLIST` – **die Liste darf nur schrumpfen**:
 * Ein neuer Treffer bricht den Test, ein erledigter Eintrag ebenfalls (er muss dann gestrichen werden). Ab Block 12 soll sie leer sein.
 */
const SRC = path.resolve(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "generated" || name === "node_modules") return [];
    return statSync(full).isDirectory() ? walk(full) : /\.tsx$/.test(name) ? [full] : [];
  });
}

const RAW_TAGS = ["button", "select", "textarea", "table", "details", "summary", "dialog", "label", "form-control"];
const CLASS_TOKENS = /(?<![\w-])(btn(?:-[a-z]+)?|input|card(?:-pad)?|badge(?:-[a-z]+)?|table|plate|field-(?:label|hint|error))(?![\w-])/;

type Finding = { file: string; line: number; text: string };

/** Bekannte Treffer der Nachbau-Regeln: Datei → Texte der Treffer. Nur streichen, nie ergänzen. */
const ALLOWLIST: Record<string, string[]> = {
  // Zellenfarben des Abwesenheitsrasters (Fläche und Schrift aus den Statustönen, Kürzel in der Zelle) – ein echter Spezialfall des Rasters
  "app/(app)/(office)/employees/absences/page.tsx": ["Hinweis-/Statusfläche selbst gebaut (Alert/StatusBadge verwenden)"],
  // Kalender (Block 6, wird dort einmal umgebaut)
  "modules/workshop/appointments/calendar.tsx": ["<Table> ohne caption"],
};
const REBUILT = "Hinweis-/Statusfläche selbst gebaut (Alert/StatusBadge verwenden)";

function check(source: string): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  const lineOf = (index: number) => source.slice(0, index).split("\n").length;

  for (const tag of RAW_TAGS) {
    for (const m of source.matchAll(new RegExp(String.raw`<${tag}(?=[\s>/])`, "g"))) found.push({ line: lineOf(m.index), text: `<${tag}>` });
  }
  // <input> ist nur als verstecktes Feld erlaubt
  for (const m of source.matchAll(/<input(?=[\s>/])[^>]*?(?:\/>|>)/g)) {
    if (!/type=["']hidden["']/.test(m[0])) found.push({ line: lineOf(m.index), text: "<input> (außer type=hidden)" });
  }
  if (/window\.confirm|\balert\(/.test(source)) found.push({ line: lineOf(source.search(/window\.confirm|\balert\(/)), text: "window.confirm/alert (ConfirmSubmitButton nutzen)" });

  // Klassen nur dort prüfen, wo sie wirken: in className="…", className={…} und clsx(…)
  const regions = source.matchAll(/className=(?:"([^"]*)"|\{((?:[^{}]|\{[^{}]*\})*)\})|clsx\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g);
  for (const region of regions) {
    const line = lineOf(region.index);
    if (region[1] !== undefined) {
      const hit = CLASS_TOKENS.exec(region[1]);
      if (hit) found.push({ line, text: `Klasse „${hit[1]}“ (Baustein verwenden)` });
      continue;
    }
    for (const str of (region[2] ?? region[3] ?? "").matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)) {
      const hit = CLASS_TOKENS.exec(str[2]);
      if (hit) found.push({ line, text: `Klasse „${hit[1]}“ (Baustein verwenden)` });
    }
  }
  // Nachgebaute Bausteine
  for (const m of source.matchAll(/bg-(?:danger|warning|info|success)-bg/g)) found.push({ line: lineOf(m.index), text: REBUILT });
  for (const m of source.matchAll(/border-b-2/g)) found.push({ line: lineOf(m.index), text: "Reiter selbst gebaut (TabNav verwenden)" });
  for (const m of source.matchAll(/<(?:Link|a)\b[^>]*text-accent-text[^>]*>/g)) found.push({ line: lineOf(m.index), text: "Link in Akzentfarbe selbst gebaut (TextLink verwenden)" });
  for (const m of source.matchAll(/<Table\b[^>]*>/g)) if (!/caption=/.test(m[0])) found.push({ line: lineOf(m.index), text: "<Table> ohne caption" });
  return found;
}

describe("UI-Bausteine", () => {
  it("außerhalb von components/ui gibt es keine rohen Elemente und keine Baustein-Klassen", () => {
    const violations: Finding[] = [];
    const used = new Set<string>();
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (rel.startsWith("components/ui/")) continue;
      const source = readFileSync(file, "utf8");
      const mayDeviate = /^(modules|capabilities)\//.test(rel) && /ui-kit-exception:\s*\S/.test(source);
      if (mayDeviate) continue;
      for (const f of check(source)) {
        if (ALLOWLIST[rel]?.includes(f.text)) used.add(`${rel}|${f.text}`);
        else violations.push({ file: rel, ...f });
      }
    }
    if (process.env.UI_KIT_LIST) console.log(violations.map((v) => `${v.file}:${v.line} ${v.text}`).join("\n"));
    assert.deepEqual(violations.map((v) => `${v.file}:${v.line} ${v.text}`), []);
    // Die Liste darf nur schrumpfen: erledigte Einträge müssen raus
    const stale = Object.entries(ALLOWLIST).flatMap(([file, texts]) => texts.filter((text) => !used.has(`${file}|${text}`)).map((text) => `${file}: ${text}`));
    assert.deepEqual(stale, [], "Einträge der ALLOWLIST ohne Treffer – bitte streichen");
  });

  it("Ausnahmen stehen nur in Modulen und tragen eine Begründung", () => {
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const source = readFileSync(file, "utf8");
      if (/ui-kit-exception/.test(source) && !rel.startsWith("components/ui/") && !rel.endsWith("ui-kit.test.ts")) {
        assert.match(rel, /^(modules|capabilities)\//, `${rel}: Ausnahmen sind nur in Funktionen erlaubt`);
        assert.match(source, /ui-kit-exception:\s*\S+/, `${rel}: Begründung fehlt`);
      }
    }
  });
});
