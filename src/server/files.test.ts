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

describe("Namen mit Punkten und Sonderfällen (Z6-2 M3)", () => {
  it("safeName fasst Punktfolgen zusammen und schützt reservierte Windows-Namen", () => {
    assert.equal(safeName("Foto..png"), "Foto.png");
    assert.equal(safeName("RE..2026"), "RE.2026");
    assert.equal(safeName("a...b....c"), "a.b.c");
    assert.equal(safeName("...."), "datei");
    assert.equal(safeName("..."), "datei");
    assert.equal(safeName(".versteckt"), "versteckt");
    assert.equal(safeName("..\\..\\x"), "x");
    assert.equal(safeName("Müller Co..GmbH"), "Mueller-Co.GmbH");
    assert.equal(safeName("日本語"), "datei", "reine Nicht-Latin-Namen werden zu „datei“ (der Pfad besteht nur aus ASCII)");
    assert.equal(safeName("Zoë–Åke"), "Zoe-Ake");
    for (const reserved of ["CON", "con", "NUL", "COM1", "lpt9", "AUX.txt", "PRN"]) assert.match(safeName(reserved), /^_/, reserved);
    for (const fine of ["CONTRACT", "COM10", "console", "NULL"]) assert.doesNotMatch(safeName(fine), /^_/, fine);
    // Ergebnis ist immer ein gültiger Pfadbestandteil
    for (const input of ["Foto..png", "....", "CON", "a/../b", "..a", "a..", "-.-", "._x", "x".repeat(300) + "..y"]) {
      const name = safeName(input);
      assert.doesNotThrow(() => resolveRel(`ordner/${name}`), `${input} → ${name}`);
      assert.ok(!name.includes(".."), name);
    }
  });

  it("storeFile legt Namen mit „..“ ab, statt zu scheitern (hochgeladenes Foto, Rechnungsnummer, Dokumentationsbild)", async () => {
    const photo = await storeFile("doku/handbook", "Foto..png", bytes("bild"));
    assert.equal(photo, "doku/handbook/Foto.png");
    const invoice = await storeFile("rechnungen/2026/eingang", "2026-03-14_Mueller-Co..GmbH_RE..2026.pdf", bytes("beleg"));
    assert.equal(invoice, "rechnungen/2026/eingang/2026-03-14_Mueller-Co.GmbH_RE.2026.pdf");
    const dots = await storeFile("doku/handbook", "....", bytes("x"));
    assert.match(dots, /^doku\/handbook\/datei(\.datei)?$/, "nur Punkte ergeben einen Ersatznamen, keinen Fehler");
    const reserved = await storeFile("doku/handbook", "CON.pdf", bytes("x"));
    assert.equal(reserved, "doku/handbook/_CON.pdf");
    const unicode = await storeFile("doku/handbook", "Übung–Ärger.png", bytes("x"));
    assert.equal(unicode, "doku/handbook/Uebung-Aerger.png");
    const folder = await storeFile("doku/Ordner..Name", "a.png", bytes("x"));
    assert.equal(folder, "doku/Ordner.Name/a.png");
    // und sie lassen sich wieder umbenennen/verschieben
    assert.equal(await moveFile(photo, "doku/handbook", "Foto..neu.png"), "doku/handbook/Foto.neu.png");
    for (const rel of [invoice, dots, reserved, unicode, folder]) assert.ok(existsSync(resolveRel(rel)), rel);
  });

  it("der Beleg-Pfad aus Partner und Nummer ist gültig, auch mit „..“ im Namen", async () => {
    const { invoiceFileLocation } = await import("@/modules/office/invoices/domain");
    const location = invoiceFileLocation({ direction: "incoming", issueDate: new Date("2026-03-14T11:00:00Z"), number: "RE..2026", partyName: "Müller Co..GmbH" }, "application/pdf");
    assert.equal(location.name, "2026-03-14_Mueller-Co.GmbH_RE.2026.pdf");
    assert.ok(await storeFile(location.dir, location.name, bytes("beleg")));
  });
});

describe("Verwaiste Zwischendateien (Z6-2 N10)", () => {
  it("cleanStaleTemp löscht nur .part-Dateien im Zwischenordner, die älter als ein Tag sind", async () => {
    const { cleanStaleTemp } = await import("./files");
    const { mkdirSync, utimesSync, writeFileSync } = await import("node:fs");
    const tmp = path.join(filesDir(), ".tmp");
    mkdirSync(tmp, { recursive: true });
    const old = path.join(tmp, "alt.part");
    const fresh = path.join(tmp, "frisch.part");
    const other = path.join(tmp, "anderes.txt");
    for (const f of [old, fresh, other]) writeFileSync(f, "x");
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    utimesSync(old, twoDaysAgo, twoDaysAgo);
    utimesSync(other, twoDaysAgo, twoDaysAgo);
    assert.equal(await cleanStaleTemp(), 1);
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(fresh), true, "ein laufender Upload ist nie so alt");
    assert.equal(existsSync(other), true, "nur .part-Dateien");
    assert.equal(await cleanStaleTemp(), 0, "wiederholbar");
    rmSync(tmp, { recursive: true, force: true });
    assert.equal(await cleanStaleTemp(), 0, "ohne Zwischenordner: nichts zu tun, kein Fehler");
  });
});
