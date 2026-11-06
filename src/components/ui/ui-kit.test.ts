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
  return found;
}

describe("UI-Bausteine", () => {
  it("außerhalb von components/ui gibt es keine rohen Elemente und keine Baustein-Klassen", () => {
    const violations: Finding[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (rel.startsWith("components/ui/")) continue;
      const source = readFileSync(file, "utf8");
      const mayDeviate = /^(modules|capabilities)\//.test(rel) && /ui-kit-exception:\s*\S/.test(source);
      if (mayDeviate) continue;
      for (const f of check(source)) violations.push({ file: rel, ...f });
    }
    if (process.env.UI_KIT_LIST) console.log(violations.map((v) => `${v.file}:${v.line} ${v.text}`).join("\n"));
    assert.deepEqual(violations.map((v) => `${v.file}:${v.line} ${v.text}`), []);
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
