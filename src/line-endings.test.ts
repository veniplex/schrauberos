import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

/**
 * Zeilenenden und Textdateien im Repository (`.gitattributes`: `* text=auto eol=lf`).
 *
 * Git meldet je Datei, wie der Inhalt im Index (`i/`) und im Arbeitsverzeichnis (`w/`) aussieht: `lf`, `crlf`, `mixed`, `none` oder `-text`
 * (= Git hält die Datei für binär – bei Quelltext meist ein einzelnes CR, ein NUL-Byte oder kaputte Kodierung). Eine Quelldatei mit `-text`,
 * `crlf` oder `mixed` im Index zerstört Diff/Blame/Merge (ein Commit zeigt dann jede Zeile als geändert, Git zeigt keinen Textunterschied mehr).
 * Dateien, die `.gitattributes` ausdrücklich als `-text` ausweist (Bilder, Schriften, Goldkorpus, Testvektoren), sind ausgenommen.
 *
 * Im Arbeitsverzeichnis sind `crlf`/`mixed` auf Windows (`core.autocrlf`) normal und werden nicht beanstandet; ein einzelnes CR (`w/-text`) schon.
 */
const git = spawnSync("git", ["ls-files", "--eol", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const available = git.status === 0 && typeof git.stdout === "string" && git.stdout.length > 0;

type Entry = { index: string; work: string; attr: string; path: string };

function parse(output: string): Entry[] {
  const out: Entry[] = [];
  for (const record of output.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [index = "", work = "", attr = ""] = record.slice(0, tab).trim().split(/\s+/);
    out.push({ index: index.replace(/^i\//, ""), work: work.replace(/^w\//, ""), attr: attr.replace(/^attr\//, ""), path: record.slice(tab + 1) });
  }
  return out;
}

describe("Zeilenenden im Repository", { skip: available ? false : "kein Git-Repository verfügbar" }, () => {
  const entries = available ? parse(git.stdout) : [];
  const textual = entries.filter((e) => e.attr !== "-text" && !e.attr.includes("binary"));

  it("kennt die getrackten Dateien", () => {
    assert.ok(entries.length > 100, "git ls-files --eol liefert die Dateiliste");
    assert.ok(textual.some((e) => e.path === "src/lib/ical.ts"));
  });

  it("keine Textdatei ist im Index CRLF, gemischt oder für Git „binär“ (einzelnes CR, NUL-Byte)", () => {
    const bad = textual.filter((e) => e.index === "crlf" || e.index === "mixed" || e.index === "-text").map((e) => `${e.path} (${e.index})`);
    assert.deepEqual(bad, [], "Zeilenenden reparieren (nur LF); ein NUL im Quelltext als \\u0000 schreiben");
  });

  it("keine Textdatei hat im Arbeitsverzeichnis ein einzelnes CR oder ein NUL-Byte (noch nicht eingecheckt, aber schon kaputt)", () => {
    const bad = textual.filter((e) => e.work === "-text").map((e) => e.path);
    assert.deepEqual(bad, []);
  });
});
