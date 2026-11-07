import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Anrede (Entscheidung D1): Die Oberfläche spricht in der Nennform („Ersten Kunden anlegen“, „Bitte anmelden“) – weder „du“ noch „Sie“. Die Anwendungsdokumentation
 * (`docs/`) ist durchgängig in der Sie-Form geschrieben. Der Test fängt Rückfälle: Du-Formen in der Oberfläche, Du-Formen in der Hilfe.
 */
const root = process.cwd();
const walk = (dir: string, match: RegExp): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n), match) : match.test(n) ? [path.join(dir, n)] : []));

const DU = /\b(du|dir|dich|dein|deine|deinen|deinem|deiner|deines)\b/i;
/** „Legen Sie …“, „stellen Sie …“: Verb, dann „Sie“ (ein Satzanfang „Sie wird …“ meint die/sie und ist erlaubt) */
const SIE_IMPERATIVE = /\b[A-Za-zÄÖÜäöüß]+(?:en|et) Sie\b/;
const IHR = /\bIhr(?:e|en|em|er|es)?\b/;
/** „… wenn Sie das Angebot erneuern“: „Sie“ nach einer unterordnenden Konjunktion (nicht der Satzanfang „Sie wird …“) */
const SIE_CLAUSE = /\b(?:wenn|dass|ob|falls|sobald|damit|weil|bevor|nachdem|solange|wie|was|wann|bis) Sie\b/;
/** Ein Text, der mit einem Imperativ der Du-Form beginnt („Lege ein Angebot an …“) */
const DU_IMPERATIVE = /:\s*"(?:Lege|Passe|Wähle|Gib|Trage|Klicke|Schreibe|Prüfe|Starte|Speichere|Öffne|Füge|Erfasse|Erstelle|Nimm|Gehe|Probiere|Versuche|Melde|Setze|Verwende|Beachte|Achte|Lösche|Ändere|Ergänze)\b/;

describe("Anrede", () => {
  const ui = walk(path.join(root, "src/i18n/messages"), /\.de\.ts$|^de\.ts$/);
  it("findet die deutschen Texte der Oberfläche", () => {
    assert.ok(ui.length > 15);
  });
  for (const file of ui) {
    it(`Oberfläche ${path.relative(root, file).split(path.sep).join("/")}: Nennform`, () => {
      const lines = readFileSync(file, "utf8").split("\n");
      const bad = lines.flatMap((line, i) => (/^\s*\/\//.test(line) ? [] : [DU, SIE_IMPERATIVE, IHR, SIE_CLAUSE, DU_IMPERATIVE].some((re) => re.test(line)) ? [`${i + 1}: ${line.trim().slice(0, 120)}`] : []));
      assert.deepEqual(bad, []);
    });
  }
  it("Hilfe (docs/): durchgängig Sie-Form, kein „du“", () => {
    const docs = walk(path.join(root, "docs"), /\.md$/);
    assert.ok(docs.length > 15);
    const bad = docs.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (DU.test(line.replace(/`[^`]*`/g, "")) ? [`${path.relative(root, file)}:${i + 1}: ${line.trim().slice(0, 100)}`] : [])),
    );
    assert.deepEqual(bad, []);
  });
});
