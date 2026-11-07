import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { makeReadOnly, removeTreeSync, syncTree } from "./fs-tree";

const work = mkdtempSync(path.join(tmpdir(), "so-fstree-"));
after(() => {
  try {
    removeTreeSync(work);
  } catch {
    /* Aufräumen */
  }
});

function sampleTree(name: string) {
  const root = path.join(work, name);
  mkdirSync(path.join(root, "a", "b"), { recursive: true });
  writeFileSync(path.join(root, "a", "b", "x.txt"), "x");
  writeFileSync(path.join(root, "run.sh"), "#!/bin/sh\n");
  if (process.platform !== "win32") chmodSync(path.join(root, "run.sh"), 0o755);
  return root;
}

describe("installierte Bäume: Haltbarkeit, Schreibschutz, Löschen", () => {
  it("syncTree läuft über Dateien und Ordner ohne Fehler (auch dort, wo Ordner nicht synchronisiert werden können)", async () => {
    const root = sampleTree("sync");
    await syncTree(root);
    assert.equal(readFileSync(path.join(root, "a", "b", "x.txt"), "utf8"), "x");
  });

  it("makeReadOnly entzieht das Schreibrecht, lässt Lesen und Ausführen bestehen; removeTreeSync löscht trotzdem", async () => {
    const root = sampleTree("ro");
    await makeReadOnly(root);
    if (process.platform !== "win32") {
      assert.equal(statSync(path.join(root, "a")).mode & 0o222, 0, "Ordner nicht schreibbar");
      assert.equal(statSync(path.join(root, "a", "b", "x.txt")).mode & 0o777, 0o444);
      assert.equal(statSync(path.join(root, "run.sh")).mode & 0o777, 0o555, "Ausführbit bleibt");
      assert.throws(() => writeFileSync(path.join(root, "a", "neu.txt"), "x"), /EACCES|EPERM/, "ein Schreibversuch in den Paketordner scheitert");
    }
    assert.equal(readFileSync(path.join(root, "a", "b", "x.txt"), "utf8"), "x");
    removeTreeSync(root);
    assert.equal(existsSync(root), false);
  });

  it("makeReadOnly setzt Setuid, Setgid und Sticky zurück (Ordner erben Setgid von einem Elternordner mit „Gruppe vererben“; der Starter lehnte sie sonst ab)", async (t) => {
    if (process.platform === "win32") return t.skip("keine POSIX-Modi");
    const root = sampleTree("setid");
    chmodSync(root, 0o3775);
    chmodSync(path.join(root, "a"), 0o2775);
    chmodSync(path.join(root, "a", "b"), 0o1777);
    chmodSync(path.join(root, "run.sh"), 0o6755);
    await makeReadOnly(root);
    for (const p of [root, path.join(root, "a"), path.join(root, "a", "b"), path.join(root, "run.sh"), path.join(root, "a", "b", "x.txt")]) assert.equal(statSync(p).mode & 0o7000, 0, p);
    assert.equal(statSync(path.join(root, "run.sh")).mode & 0o777, 0o555, "Ausführbit bleibt");
    removeTreeSync(root);
  });

  it("removeTreeSync verträgt Nichtvorhandenes", () => {
    removeTreeSync(path.join(work, "gibt-es-nicht"));
  });
});
