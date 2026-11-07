import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { rawTar, type RawEntry } from "@/test/tar";
import { ArchiveError, extractArchive, symlinkStaysInside, unsafeEntryPath } from "./archive";

/**
 * Entpacken (lib/archive.ts): Verhalten mit echten, auch bösartigen Archiven – nichts außerhalb des Ziels, keine Links/Geräte, Obergrenzen für Einträge und Größe.
 */
const root = mkdtempSync(path.join(tmpdir(), "so-archive-"));
after(() => rmSync(root, { recursive: true, force: true }));
const LIMITS = { maxEntries: 100, maxBytes: 1_000_000 };

let work: string;
let target: string;
let n = 0;
beforeEach(() => {
  work = path.join(root, `t${++n}`);
  target = path.join(work, "ziel");
  mkdirSync(target, { recursive: true });
});

/** Packt Einträge in eine Datei und entpackt sie; liefert den Fehlercode (oder null). */
async function extract(entries: RawEntry[], limits = LIMITS, options: Parameters<typeof extractArchive>[3] = {}) {
  const file = path.join(work, "a.tar");
  writeFileSync(file, rawTar(entries));
  try {
    await extractArchive(file, target, limits, options);
    return null;
  } catch (error) {
    if (error instanceof ArchiveError) return error.code;
    throw error;
  }
}

describe("Entpacken von Archiven", () => {
  it("entpackt Ordner und normale Dateien (auch .tar.gz) und meldet Einträge und Größe", async () => {
    const entries: RawEntry[] = [{ name: "a/", type: "5" }, { name: "a/datei.txt", data: "Hallo" }, { name: "b.txt", data: "Welt" }];
    for (const gz of [false, true]) {
      rmSync(target, { recursive: true, force: true });
      mkdirSync(target);
      const file = path.join(work, `ok${gz}.tar`);
      writeFileSync(file, gz ? gzipSync(rawTar(entries)) : rawTar(entries));
      assert.deepEqual(await extractArchive(file, target, LIMITS), { entries: 3, bytes: 9 });
      assert.equal(readFileSync(path.join(target, "a", "datei.txt"), "utf8"), "Hallo");
      assert.equal(readFileSync(path.join(target, "b.txt"), "utf8"), "Welt");
    }
  });

  it("lehnt Symlinks ab (auch auf Ziele außerhalb) – es entsteht kein Link und nichts außerhalb", async () => {
    const code = await extract([{ name: "ok.txt", data: "x" }, { name: "link", type: "2", linkname: "../../geheim" }, { name: "link/boese.txt", data: "böse" }]);
    assert.equal(code, "unsupported");
    assert.equal(existsSync(path.join(target, "link")), false);
    assert.equal(existsSync(path.join(work, "boese.txt")), false);
    assert.equal(existsSync(path.join(target, "link", "boese.txt")), false);
  });

  it("lehnt Hardlinks ab (sie würden auf fremde Dateien zeigen)", async () => {
    writeFileSync(path.join(work, "fremd.txt"), "fremd");
    assert.equal(await extract([{ name: "hart", type: "1", linkname: "../fremd.txt" }]), "unsupported");
    assert.equal(existsSync(path.join(target, "hart")), false);
  });

  it("lehnt Geräte-Dateien und Pipes ab", async () => {
    for (const type of ["3", "4", "6"] as const) assert.equal(await extract([{ name: "dev", type }]), "unsupported", `Typ ${type}`);
  });

  it("lehnt Pfade mit „..“ ab; außerhalb des Ziels entsteht nichts", async () => {
    assert.equal(await extract([{ name: "../draussen.txt", data: "x" }]), "unsafePath");
    assert.equal(await extract([{ name: "a/../../draussen2.txt", data: "x" }]), "unsafePath");
    assert.equal(existsSync(path.join(work, "draussen.txt")), false);
    assert.equal(existsSync(path.join(work, "draussen2.txt")), false);
    assert.equal(existsSync(path.join(root, "draussen2.txt")), false);
  });

  it("lehnt absolute Pfade ab (Unix, Laufwerk, Rückwärtsstrich)", async () => {
    const abs = path.join(work, "absolut.txt").replace(/\\/g, "/");
    assert.equal(await extract([{ name: abs.startsWith("/") ? abs : `/${abs}`, data: "x" }]), "unsafePath");
    assert.equal(await extract([{ name: "C:/Windows/x.txt", data: "x" }]), "unsafePath");
    // unter Windows macht die Archiv-Bibliothek aus dem Rückwärtsstrich selbst einen Trenner
    if (process.platform !== "win32") assert.equal(await extract([{ name: "a\\b.txt", data: "x" }]), "unsafePath");
    assert.equal(existsSync(path.join(work, "absolut.txt")), false);
  });

  it("zu viele Einträge: Abbruch, die überzähligen werden nicht mehr geschrieben", async () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.txt`, data: "x" }));
    assert.equal(await extract(entries, { maxEntries: 3, maxBytes: 1_000_000 }), "tooManyEntries");
    assert.equal(existsSync(path.join(target, "f0.txt")), true, "bis zur Grenze wurde geschrieben");
    assert.equal(existsSync(path.join(target, "f3.txt")), false);
    assert.equal(existsSync(path.join(target, "f5.txt")), false);
  });

  it("zu große Gesamtgröße: Abbruch schon am Kopf, ohne die Daten zu schreiben", async () => {
    assert.equal(await extract([{ name: "a.bin", data: Buffer.alloc(600) }, { name: "b.bin", data: Buffer.alloc(600) }], { maxEntries: 10, maxBytes: 1000 }), "tooLarge");
    assert.equal(existsSync(path.join(target, "b.bin")), false);
    // riesig angekündigt, Archiv abgeschnitten (kein Gigabyte nötig)
    assert.equal(await extract([{ name: "riesig.bin", declaredSize: 50 * 1024 ** 3, data: "kurz" }], LIMITS), "tooLarge");
    assert.equal(existsSync(path.join(target, "riesig.bin")), false);
  });

  it("Müll ist „corrupt“", async () => {
    const file = path.join(work, "muell.tar");
    writeFileSync(file, Buffer.from("das ist kein Archiv, nur Text ".repeat(100)));
    await assert.rejects(extractArchive(file, target, LIMITS), (e) => e instanceof ArchiveError && e.code === "corrupt");
  });

  it("Symlinks nur auf Wunsch und nur, wenn das Ziel im Paket bleibt", async () => {
    assert.equal(await extract([{ name: "lib/a.so.1", data: "x" }, { name: "lib/a.so", type: "2", linkname: "../../../draussen" }], LIMITS, { symlinks: "inside" }), "unsafePath");
    assert.equal(await extract([{ name: "lib/a", type: "2", linkname: "/etc/passwd" }], LIMITS, { symlinks: "inside" }), "unsafePath");
    assert.equal(await extract([{ name: "lib/a", type: "1", linkname: "x" }], LIMITS, { symlinks: "inside" }), "unsupported", "Hardlinks nie");
    assert.equal(await extract([{ name: "lib/a", type: "2", linkname: "x" }], LIMITS), "unsupported", "ohne Wunsch keine Symlinks");
    if (process.platform !== "win32") {
      rmSync(target, { recursive: true, force: true });
      mkdirSync(target);
      assert.equal(await extract([{ name: "lib/a.so.1", data: "x" }, { name: "lib/a.so", type: "2", linkname: "a.so.1" }], LIMITS, { symlinks: "inside" }), null);
    }
  });
});

describe("Pfadprüfung", () => {
  it("unsafeEntryPath", () => {
    for (const bad of ["", "/abs", "../x", "a/../b", "a/..", "C:/x", "c:x", "a\\b", "a\0b"]) assert.equal(unsafeEntryPath(bad), true, JSON.stringify(bad));
    for (const ok of ["a", "a/b.txt", "./a", "a/./b", "a..b/c", "files/2026/Beleg..pdf"]) assert.equal(unsafeEntryPath(ok), false, ok);
  });

  it("symlinkStaysInside: relativ und nicht über die Wurzel hinaus", () => {
    assert.equal(symlinkStaysInside("lib/a.so", "a.so.1"), true);
    assert.equal(symlinkStaysInside("lib/a.so", "../other/b"), true);
    assert.equal(symlinkStaysInside("lib/a.so", "../../b"), false);
    assert.equal(symlinkStaysInside("a", ".."), false);
    assert.equal(symlinkStaysInside("a", "/etc/passwd"), false);
    assert.equal(symlinkStaysInside("a", "C:/x"), false);
    assert.equal(symlinkStaysInside("a", ""), false);
  });
  it("symlinkStaysInside: ein „..“ hinter einem Namen wird abgelehnt (textuelle Auflösung stimmt nicht über Symlink-Zwischenglieder)", () => {
    assert.equal(symlinkStaysInside("lib/a.so", "../x/y"), true);
    assert.equal(symlinkStaysInside("lib/a.so", "./b"), true);
    assert.equal(symlinkStaysInside("a", "x/../y"), false);
    assert.equal(symlinkStaysInside("a/b/c/z", "y/../../.."), false);
    assert.equal(symlinkStaysInside("a", "x/.."), false);
  });
});

describe("Symlinks: Prüfung auf dem Dateisystem (ZP3-S-F3) und lange Pfade", () => {
  const linux = process.platform !== "win32";

  it("assertSymlinksInside: Links im Baum bleiben im Ziel – auch über Zwischenglieder, die selbst Symlinks sind; Schleifen und Ziele außerhalb werden abgelehnt", { skip: !linux }, async () => {
    const { symlinkSync } = await import("node:fs");
    const { assertSymlinksInside } = await import("./archive");
    mkdirSync(path.join(target, "a", "b", "c"), { recursive: true });
    mkdirSync(path.join(work, "draussen"));
    symlinkSync("../..", path.join(target, "a", "b", "c", "y")); // zeigt auf „a“: innen
    symlinkSync("b", path.join(target, "a", "ok")); // innen
    symlinkSync("gibt-es-nicht", path.join(target, "a", "lose")); // ins Leere, aber im Ziel
    await assertSymlinksInside(target);

    // wirkliche Auflösung über das Zwischenglied y (= a): „y/../..“ landet außerhalb des Ziels – textuell sah es innen aus
    symlinkSync("a/b/c/y/../..", path.join(target, "z"));
    await assert.rejects(assertSymlinksInside(target), (e) => e instanceof ArchiveError && e.code === "unsafePath");
    rmSync(path.join(target, "z"));
    await assertSymlinksInside(target);

    symlinkSync(path.join(work, "draussen"), path.join(target, "a", "raus"));
    await assert.rejects(assertSymlinksInside(target), (e) => e instanceof ArchiveError && e.code === "unsafePath");
    rmSync(path.join(target, "a", "raus"));

    symlinkSync("../schleife2", path.join(target, "a", "schleife1"));
    symlinkSync("a/schleife1", path.join(target, "schleife2"));
    await assert.rejects(assertSymlinksInside(target), (e) => e instanceof ArchiveError && e.code === "unsafePath", "Schleife");
  });

  it("extractArchive mit „inside“: ein Symlink auf den eigenen Ordner und ein „..“-Link darüber schreiben nichts außerhalb", { skip: !linux }, async () => {
    const outside = path.join(work, "draussen.txt");
    const code = await extract(
      [
        { name: "d/", type: "5" },
        { name: "d/self", type: "2", linkname: "." },
        { name: "d/self/up", type: "2", linkname: ".." },
        { name: "d/self/up/draussen.txt", data: "böse" },
      ],
      LIMITS,
      { symlinks: "inside" },
    );
    void code; // je nach node-tar abgelehnt oder harmlos innerhalb des Ziels entpackt – entscheidend ist, dass nichts außerhalb landet
    assert.equal(existsSync(outside), false);
    assert.equal(existsSync(path.join(work, "up")), false);
  });

  it("GNU-Langname mit „..“ wird erkannt (der Eintrag trägt den langen Pfad außerhalb des 100-Zeichen-Kopfes); ein langer, harmloser Pfad wird entpackt", async () => {
    const long = "ordner/".repeat(20);
    assert.equal(await extract([{ name: "././@LongLink", type: "L", data: `${long}../../draussen.txt\0` }, { name: "gekuerzt", data: "böse" }]), "unsafePath");
    assert.equal(existsSync(path.join(work, "draussen.txt")), false);
    assert.equal(existsSync(path.join(target, "gekuerzt")), false, "nach dem ersten Verstoß wird nichts mehr geschrieben");
    assert.equal(await extract([{ name: "././@LongLink", type: "L", data: `${long}datei.txt\0` }, { name: "gekuerzt", data: "gut" }]), null);
    assert.equal(readFileSync(path.join(target, `${long}datei.txt`), "utf8"), "gut");
  });
});
