import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { filesDir, moveFile, removeFile, resolveRel, safeName, storeFile } from "./files";

const data = mkdtempSync(path.join(tmpdir(), "so-files-"));
process.env.DATA_DIR = data;
after(() => rmSync(data, { recursive: true, force: true }));

const bytes = (s: string) => new TextEncoder().encode(s);

describe("Dateispeicher", () => {
  it("macht Namen sicher und lesbar", () => {
    assert.equal(safeName("Müller & Söhne GmbH"), "Mueller-Soehne-GmbH");
    assert.equal(safeName("RE 2026/0042"), "RE-2026-0042");
    assert.equal(safeName("../../etc/passwd"), "etc-passwd");
    assert.equal(safeName("   "), "datei");
    assert.equal(safeName("a".repeat(200)).length, 60);
    assert.match(safeName("Straße Ärger"), /^Strasse-Aerger$/);
  });

  it("lässt nur feste Pfadmuster zu (kein Pfad-Trick)", () => {
    assert.ok(resolveRel("rechnungen/2026/eingang/a.pdf").startsWith(filesDir()));
    for (const bad of ["../x", "a/../b", "/etc/passwd", "a//b", ".tmp/x", "a/.hidden", "a\b", "", "a b/c", "a/b/.."]) {
      assert.throws(() => resolveRel(bad), /Ungültig/, bad);
    }
  });

  it("legt Dateien lesbar ab und überschreibt nie", async () => {
    const a = await storeFile("rechnungen/2026/eingang", "2026-03-14_Lieferant_RE-1.pdf", bytes("eins"));
    const b = await storeFile("rechnungen/2026/eingang", "2026-03-14_Lieferant_RE-1.pdf", bytes("zwei"));
    const c = await storeFile("rechnungen/2026/eingang", "2026-03-14_Lieferant_RE-1.PDF", bytes("drei"));
    assert.equal(a, "rechnungen/2026/eingang/2026-03-14_Lieferant_RE-1.pdf");
    assert.equal(b, "rechnungen/2026/eingang/2026-03-14_Lieferant_RE-1-2.pdf");
    assert.equal(c, "rechnungen/2026/eingang/2026-03-14_Lieferant_RE-1-3.pdf");
    assert.equal(readFileSync(resolveRel(a), "utf8"), "eins");
    assert.equal(readFileSync(resolveRel(b), "utf8"), "zwei");
  });

  it("behandelt gleichzeitiges Ablegen gleicher Namen ohne Verlust", async () => {
    const rels = await Promise.all(Array.from({ length: 8 }, (_, i) => storeFile("doku/werkstatt", "bild.png", bytes(`inhalt ${i}`))));
    assert.equal(new Set(rels).size, 8);
    const contents = rels.map((r) => readFileSync(resolveRel(r), "utf8")).sort();
    assert.deepEqual(contents, Array.from({ length: 8 }, (_, i) => `inhalt ${i}`).sort());
  });

  it("säubert Namen und Ordner aus Eingaben", async () => {
    const rel = await storeFile("../../evil dir", "../x/y z.pdf", bytes("x"));
    assert.ok(!rel.includes(".."));
    assert.ok(resolveRel(rel).startsWith(filesDir() + path.sep));
  });

  it("legt keine Zwischendateien im Dateibaum zurück", async () => {
    await storeFile("rechnungen/2026/ausgang", "x.pdf", bytes("x"));
    assert.deepEqual(readdirSync(path.join(filesDir(), ".tmp")), []);
  });

  it("verschiebt Dateien ohne Überschreiben und räumt leere Ordner auf", async () => {
    const a = await storeFile("rechnungen/2025/eingang", "alt.pdf", bytes("alt"));
    const moved = await moveFile(a, "rechnungen/2026/eingang", "neu.pdf");
    assert.equal(moved, "rechnungen/2026/eingang/neu.pdf");
    assert.equal(readFileSync(resolveRel(moved), "utf8"), "alt");
    assert.equal(existsSync(path.join(filesDir(), "rechnungen", "2025")), false);
    // Ziel belegt: Zähler statt Überschreiben
    const other = await storeFile("rechnungen/2025/eingang", "zwei.pdf", bytes("zwei"));
    const second = await moveFile(other, "rechnungen/2026/eingang", "neu.pdf");
    assert.equal(second, "rechnungen/2026/eingang/neu-2.pdf");
    assert.equal(readFileSync(resolveRel(moved), "utf8"), "alt");
  });

  it("löscht Dateien, auch wiederholt, und lässt Nachbarn stehen", async () => {
    const a = await storeFile("doku/büro", "a.png", bytes("a"));
    const b = await storeFile("doku/büro", "b.png", bytes("b"));
    await removeFile(a);
    await removeFile(a);
    assert.equal(existsSync(resolveRel(b)), true);
    await removeFile(b);
    assert.equal(existsSync(path.join(filesDir(), "doku", "buero")), false);
  });
});
