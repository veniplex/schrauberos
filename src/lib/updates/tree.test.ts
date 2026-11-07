import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { assertConsistent, generateTree, nodeFs, parseTree, pathProblem, serializeTree, TREE_HEADER, TREE_LIMITS, TreeError, targetProblem, treeStats, verifyTreeAgainstFs, type TreeEntry } from "./tree.ts";
import { MemoryFs } from "./tree-testkit.ts";

const HASH = "b".repeat(128);
const file = (p: string, extra: Partial<TreeEntry> = {}): TreeEntry => ({ type: "f", exec: false, size: 3, hash: HASH, path: p, ...extra });
const dir = (p: string): TreeEntry => ({ type: "d", exec: false, size: 0, path: p });
const link = (p: string, target: string): TreeEntry => ({ type: "l", exec: false, size: 0, target, path: p });

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
  } catch (error) {
    return error instanceof TreeError ? error.code : `fremd:${String(error)}`;
  }
  return null;
};

describe("SOS-TREE: Format", () => {
  it("serialisiert genau das dokumentierte Format und liest es zurück", () => {
    const entries = [dir("a"), file("a/x.js", { exec: true, size: 12 }), link("a/l", "x.js"), file("z", { size: 0 })];
    const text = serializeTree(entries).toString("utf8");
    assert.equal(text, `${TREE_HEADER}d\t-\t0\t-\ta\nl\t-\t0\tx.js\ta/l\nf\tx\t12\t${HASH}\ta/x.js\nf\t-\t0\t${HASH}\tz\n`);
    assert.deepEqual(parseTree(Buffer.from(text)), [dir("a"), link("a/l", "x.js"), file("a/x.js", { exec: true, size: 12 }), file("z", { size: 0 })]);
    assert.deepEqual(treeStats(parseTree(Buffer.from(text))), { entries: 4, bytes: 12 });
  });

  it("sortiert nach den Bytes des Pfads, nicht nach Locale oder UTF-16 ('.' < '/')", () => {
    const entries = [dir("a"), dir("a.b"), file("a/c"), file("a.b/d"), file("é"), file("z"), file("Z")];
    const sorted = parseTree(serializeTree(entries)).map((e) => e.path);
    assert.deepEqual(sorted, ["Z", "a", "a.b", "a.b/d", "a/c", "z", "é"].sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y))));
    assert.deepEqual(sorted, ["Z", "a", "a.b", "a.b/d", "a/c", "z", "é"]);
  });

  it("die leere Liste ist gültig", () => {
    assert.deepEqual(parseTree(Buffer.from(TREE_HEADER)), []);
  });

  it("lehnt unzulässige Namen ab", () => {
    for (const bad of ["a\tb", "a\nb", "a\rb", "a\0b", "a\u0001b", "a\u007fb", "a\\b", "a�b", "", "/abs", "./x", "a//b", "a/./b", "a/../b", "..", "x".repeat(1025), Array.from({ length: 49 }, () => "d").join("/")]) {
      assert.notEqual(pathProblem(bad), null, JSON.stringify(bad.slice(0, 30)));
    }
    for (const good of ["a", "a b", "ä/ö", ".hidden", "a.b/c-d_e", "x".repeat(1024), Array.from({ length: 48 }, () => "d").join("/")]) assert.equal(pathProblem(good), null, good.slice(0, 20));
  });

  it("Symlink-Ziele: relativ, kanonisch, nur führende '..'", () => {
    for (const good of ["x", "../x", "../../a/b", "a/b/c"]) assert.equal(targetProblem(good), null, good);
    for (const bad of ["", "/x", "a/../b", "./x", "a//b", "..", "../..", "a\\b", "a\tb", "a\u0000b"]) assert.notEqual(targetProblem(bad), null, JSON.stringify(bad));
  });

  it("die Prüfung einer Liste: Sortierung, Doppelte, Elternordner, Typen, Größen, Links", () => {
    assert.equal(codeOf(() => assertConsistent([file("b"), file("a")])), "format");
    assert.equal(codeOf(() => assertConsistent([file("a"), file("a")])), "format");
    assert.equal(codeOf(() => assertConsistent([file("a/b")])), "format", "Elternordner fehlt");
    assert.equal(codeOf(() => assertConsistent([file("a"), file("a/b")])), "format", "Elternteil ist eine Datei");
    assert.equal(codeOf(() => assertConsistent([file("SOS-TREE")])), "name");
    assert.equal(codeOf(() => assertConsistent([file("SOS-SEAL")])), "name");
    assert.equal(codeOf(() => assertConsistent([dir("d"), file("d/SOS-TREE")])), null, "in Unterordnern gibt es keine Sonderbehandlung");
    assert.equal(codeOf(() => assertConsistent([{ ...file("a"), hash: undefined }])), "format");
    assert.equal(codeOf(() => assertConsistent([{ ...dir("a"), exec: true }])), "format");
    assert.equal(codeOf(() => assertConsistent([{ ...dir("a"), size: 1 }])), "format");
    assert.equal(codeOf(() => assertConsistent([file("a", { size: -1 })])), "limit");
    assert.equal(codeOf(() => assertConsistent([link("l", "/etc/passwd")])), "link");
    assert.equal(codeOf(() => assertConsistent([link("l", "../x")])), "link", "verlässt den Baum");
    assert.equal(codeOf(() => assertConsistent([dir("a"), link("a/l", "../x")])), null, "bleibt im Baum");
    assert.equal(codeOf(() => assertConsistent([dir("a"), link("a/b", "../a"), link("c", "a/b/x")].sort((x, y) => (x.path < y.path ? -1 : 1)))), "link", "über einen Symlink");
  });

  it("parseTree lehnt jede formale Abweichung ab", () => {
    const good = serializeTree([dir("a"), file("a/x", { exec: true })]).toString();
    const variants: Record<string, string> = {
      "CRLF": good.replace(/\n/g, "\r\n"),
      "ohne Schluss-Zeilenende": good.slice(0, -1),
      "andere Kopfzeile": good.replace("tree 1", "tree 2"),
      "anderer Hash-Algorithmus": good.replace("sha512", "sha256"),
      "BOM": "﻿" + good,
      "Leerzeile": good + "\n",
      "Leerzeichen statt TAB": good.replace("a/x", "a/x ").replace(/\t/g, " "),
      "vier Felder": good.replace(`\t${HASH}`, ""),
      "unbekannter Typ": good.replace("d\t-", "q\t-"),
      "Ausführbit X": good.replace("\tx\t", "\tX\t"),
      "Größe mit Null vorn": good.replace("\t3\t", "\t03\t"),
      "Größe mit Plus": good.replace("\t3\t", "\t+3\t"),
      "Hash in Großbuchstaben": good.replace(HASH, HASH.toUpperCase()),
      "kurzer Hash": good.replace(HASH, HASH.slice(1)),
    };
    for (const [name, text] of Object.entries(variants)) assert.notEqual(codeOf(() => parseTree(Buffer.from(text))), null, name);
    assert.notEqual(codeOf(() => parseTree(Buffer.from([0x80, 0x81]))), null, "kein UTF-8");
  });

  it("Zufallseingaben und zufällig veränderte gültige Listen lassen den Parser nie abstürzen: entweder gültig oder TreeError", () => {
    const good = serializeTree([dir("a"), file("a/x", { exec: true }), link("l", "a/x"), file("zeta")]);
    let seed = 12345;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 3000; i++) {
      const copy = Buffer.from(good);
      for (let k = 0; k < 1 + Math.floor(random() * 4); k++) copy[Math.floor(random() * copy.length)] = Math.floor(random() * 256);
      const cut = random() < 0.2 ? copy.subarray(0, Math.floor(random() * copy.length)) : copy;
      const outcome = codeOf(() => parseTree(cut));
      assert.ok(outcome === null || !outcome.startsWith("fremd:"), outcome ?? "");
    }
    for (let i = 0; i < 500; i++) {
      const noise = Buffer.alloc(Math.floor(random() * 300));
      for (let k = 0; k < noise.length; k++) noise[k] = Math.floor(random() * 256);
      const outcome = codeOf(() => parseTree(noise));
      assert.ok(outcome === null || !outcome.startsWith("fremd:"));
    }
  });

  it("Grenzen: zu viele Einträge werden abgelehnt", () => {
    const lines = Array.from({ length: TREE_LIMITS.maxEntries + 1 }, (_, i) => `f\t-\t0\t${HASH}\tf${String(i).padStart(7, "0")}\n`).join("");
    assert.equal(codeOf(() => parseTree(Buffer.from(TREE_HEADER + lines))), "limit");
  });
});

describe("SOS-TREE: Generator", () => {
  const sample = () =>
    new MemoryFs()
      .dir("bin")
      .file("bin/run", "#!/bin/sh\n", 0o755)
      .file("data.json", "{}", 0o644)
      .link("bin/alias", "run")
      .dir("empty")
      .file("SOS-TREE", "alt")
      .file("SOS-SEAL", "alt");

  it("erfasst Ordner (auch leere), Dateien mit Ausführbit und Symlinks – nicht SOS-TREE und SOS-SEAL im Wurzelordner", async () => {
    const entries = await generateTree(sample());
    assert.deepEqual(
      entries.map((e) => `${e.type}${e.exec ? "x" : "-"} ${e.path}`),
      ["d- bin", "l- bin/alias", "fx bin/run", "f- data.json", "d- empty"],
    );
    assert.equal(entries.find((e) => e.path === "data.json")!.size, 2);
  });

  it("derselbe Baum ergibt dieselben Bytes (unabhängig von der Reihenfolge der Verzeichnisauflistung)", async () => {
    const a = serializeTree(await generateTree(sample()));
    const reversed = sample();
    reversed.nodes = new Map([...reversed.nodes].reverse());
    assert.ok(a.equals(serializeTree(await generateTree(reversed))));
  });

  it("bricht bei Sonderdateien, Setid, verbotenen Namen und Links aus dem Baum laut ab", async () => {
    const attempt = async (mutate: (fs: MemoryFs) => void) => {
      const fs = sample();
      mutate(fs);
      return generateTree(fs).then(() => null, (error: unknown) => (error instanceof TreeError ? error.code : String(error)));
    };
    assert.equal(await attempt((fs) => fs.other("fifo")), "type");
    assert.equal(await attempt((fs) => fs.nodes.set("data.json", { kind: "file", content: Buffer.from("x"), mode: 0o4755 })), "setid");
    assert.equal(await attempt((fs) => fs.nodes.set("bin", { kind: "dir", mode: 0o1777 })), "setid");
    assert.equal(await attempt((fs) => fs.file("a\tb", "x")), "name");
    assert.equal(await attempt((fs) => fs.file("a\nb", "x")), "name");
    assert.equal(await attempt((fs) => fs.file("x".repeat(1025), "x")), "name");
    assert.equal(await attempt((fs) => fs.link("l", "/etc/passwd")), "link");
    assert.equal(await attempt((fs) => fs.link("l", "../../x")), "link");
    assert.equal(await attempt((fs) => fs.nodes.set("SOS-TREE", { kind: "dir", mode: 0o755 })), "type");
    assert.equal(await attempt((fs) => fs.dir("sos").file("sos/SOS-TREE", "ok")), null);
  });
});

describe("SOS-TREE: Referenzprüfer (Mengengleichheit)", () => {
  const build = async () => {
    const fs = new MemoryFs().dir("a").file("a/x", "xx").file("run", "r", 0o755).link("a/l", "x").dir("leer");
    const entries = await generateTree(fs);
    return { fs, entries };
  };
  const check = async (mutate: (fs: MemoryFs) => void) => {
    const { fs, entries } = await build();
    mutate(fs);
    return verifyTreeAgainstFs(fs, entries);
  };

  it("der unveränderte Baum besteht", async () => {
    assert.equal(await check(() => undefined), null);
    const { fs, entries } = await build();
    fs.file("SOS-TREE", "x").file("SOS-SEAL", "y");
    assert.equal(await verifyTreeAgainstFs(fs, entries), null, "die beiden Wurzeldateien zählen nicht");
  });

  it("zusätzliche Dinge jeder Art (auch versteckte und leere Ordner) werden abgelehnt – nur dort, wo sie liegen", async () => {
    for (const [name, mutate] of Object.entries({
      datei: (fs: MemoryFs) => fs.file("neu", "x"),
      versteckt: (fs: MemoryFs) => fs.file(".cache", "x"),
      ordner: (fs: MemoryFs) => fs.dir("neuer-ordner"),
      tief: (fs: MemoryFs) => fs.file("a/neu", "x"),
      link: (fs: MemoryFs) => fs.link("a/neu", "x"),
      fifo: (fs: MemoryFs) => fs.other("a/pipe"),
    })) {
      const failure = await check(mutate);
      assert.equal(failure?.code, 15, name);
      assert.equal(failure?.reason, "extra", name);
    }
    assert.equal((await check((fs) => fs.file("SOS-TREE", "x").dir("SOS-X")))?.path, "SOS-X");
  });

  it("fehlende Einträge, Typtausch, Inhalt, Größe, Ausführbit, Setid und Linkziel", async () => {
    assert.deepEqual(await check((fs) => fs.remove("a/x")), { code: 14, reason: "missing", path: "a/x" });
    assert.deepEqual(await check((fs) => fs.remove("leer")), { code: 14, reason: "missing", path: "leer" });
    assert.deepEqual(await check((fs) => fs.remove("a/x").dir("a/x")), { code: 16, reason: "type", path: "a/x" });
    assert.deepEqual(await check((fs) => fs.file("a/x", "xyz")), { code: 16, reason: "size", path: "a/x" });
    assert.deepEqual(await check((fs) => fs.file("a/x", "yy")), { code: 16, reason: "hash", path: "a/x" });
    assert.deepEqual(await check((fs) => fs.file("run", "r", 0o644)), { code: 16, reason: "exec", path: "run" });
    assert.deepEqual(await check((fs) => fs.file("run", "r", 0o4755)), { code: 16, reason: "setid", path: "run" });
    assert.deepEqual(await check((fs) => fs.link("a/l", "y")), { code: 16, reason: "target", path: "a/l" });
    assert.equal(await check((fs) => fs.file("a/x", "xx", 0o755)), null, "zusätzliche Ausführbits an Dateien ohne x sind gleichgültig");
  });

  it("Ein-/Ausgabefehler sind kein Befund über den Inhalt (Code 17, 'unklar')", async () => {
    const { fs, entries } = await build();
    fs.failing.add("a/x");
    assert.deepEqual(await verifyTreeAgainstFs(fs, entries), { code: 17, reason: "io", path: "a/x" });
  });
});

describe("SOS-TREE: echtes Dateisystem (nodeFs)", () => {
  const roots: string[] = [];
  after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
  const make = () => {
    const root = mkdtempSync(path.join(tmpdir(), "so-tree-"));
    roots.push(root);
    mkdirSync(path.join(root, "a", "b"), { recursive: true });
    writeFileSync(path.join(root, "a", "b", "x.txt"), "hallo");
    writeFileSync(path.join(root, "leer.txt"), "");
    mkdirSync(path.join(root, "leer-ordner"));
    return root;
  };

  it("erzeugt, serialisiert und prüft einen echten Baum; erkennt Änderungen, Ergänzungen und Fehlendes", async () => {
    const root = make();
    const entries = await generateTree(nodeFs(root));
    assert.deepEqual(entries.map((e) => e.path), ["a", "a/b", "a/b/x.txt", "leer-ordner", "leer.txt"]);
    assert.equal(await verifyTreeAgainstFs(nodeFs(root), parseTree(serializeTree(entries))), null);

    writeFileSync(path.join(root, "a", "b", "x.txt"), "hallo!");
    assert.equal((await verifyTreeAgainstFs(nodeFs(root), entries))?.code, 16);
    writeFileSync(path.join(root, "a", "b", "x.txt"), "hallo");
    writeFileSync(path.join(root, ".versteckt"), "x");
    assert.deepEqual(await verifyTreeAgainstFs(nodeFs(root), entries), { code: 15, reason: "extra", path: ".versteckt" });
    rmSync(path.join(root, ".versteckt"));
    rmSync(path.join(root, "leer.txt"));
    assert.equal((await verifyTreeAgainstFs(nodeFs(root), entries))?.code, 14);
  });

  it("nodeFs: lstat folgt keinem Symlink; fehlende Pfade sind null; Lesen ist begrenzt", async () => {
    const root = make();
    const fs = nodeFs(root);
    assert.equal(await fs.lstat("gibt-es-nicht"), null);
    assert.equal((await fs.lstat("a/b/x.txt"))?.kind, "file");
    assert.equal((await fs.lstat(""))?.kind, "dir");
    assert.equal((await fs.readFile("a/b/x.txt", 100))?.toString(), "hallo");
    assert.equal(await fs.readFile("a/b/x.txt", 3), null, "größer als erlaubt");
    assert.equal((await fs.hash("leer.txt")).sha512.length, 128);
    try {
      symlinkSync("a", path.join(root, "link"), "dir");
    } catch {
      return; // Symlinks ohne Berechtigung (Windows): nur Linux prüft das
    }
    assert.equal((await fs.lstat("link"))?.kind, "symlink");
    assert.equal(await fs.readlink("link"), "a");
  });
});
