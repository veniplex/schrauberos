import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import * as fontkit from "fontkit";
import { FONT_DIR, FONT_FILES, loadFonts } from "./fonts";

/** Die eingebettete Schrift: unverändert (Prüfsummen aus `assets/fonts/SOURCE.txt`), mit Lizenztext, und sie deckt Umlaute, Eszett und das Euro-Zeichen ab. */
describe("Schrift der PDF-Erzeugung", () => {
  const source = readFileSync(path.join(FONT_DIR(), "SOURCE.txt"), "utf8");
  const sums = new Map([...source.matchAll(/^([0-9a-f]{64})\s+(\S+)$/gm)].map((m) => [m[2], m[1]]));
  const sha = (file: string) => createHash("sha256").update(readFileSync(path.join(FONT_DIR(), file))).digest("hex");

  it("Schriftdateien und Lizenztext stimmen mit den Prüfsummen in SOURCE.txt überein", () => {
    for (const file of [FONT_FILES.regular, FONT_FILES.bold, "OFL.txt"]) {
      assert.ok(sums.has(file), `${file}: keine Prüfsumme in SOURCE.txt`);
      assert.equal(sha(file), sums.get(file), `${file}: Datei weicht von der dokumentierten Fassung ab`);
    }
  });

  it("die Lizenz ist die SIL Open Font License und SOURCE.txt nennt Quelle und Lizenz", () => {
    assert.match(readFileSync(path.join(FONT_DIR(), "OFL.txt"), "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/);
    assert.match(source, /SIL Open Font License 1\.1/);
    assert.match(source, /https:\/\/github\.com\/notofonts\//);
  });

  it("Regular und Bold enthalten Umlaute, Eszett (auch großes), Euro, typografische Anführungszeichen und Gedankenstrich", () => {
    const fonts = loadFonts();
    for (const buffer of [fonts.regular, fonts.bold]) {
      const font = fontkit.create(buffer) as fontkit.Font;
      for (const char of "ÄÖÜäöüßẞ€„“–—…§°²³½±×") assert.ok(font.hasGlyphForCodePoint(char.codePointAt(0)!), `Glyphe fehlt: ${char}`);
    }
  });
});
