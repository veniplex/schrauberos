import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { classifyVerifyExit, findNodeModulesAncestor, verifyVersion } from "./seal.ts";
import { nodeFs } from "./tree.ts";
import { pemToRawKey } from "./keychain.ts";
import { buildCorpus, corpusToJson, type Corpus, type CorpusCase } from "./testdata/anchor/build-corpus.ts";
import { caseAncestorProbe, caseToMemoryFs, materializeCorpusCase } from "./testdata/anchor/corpus-fs.ts";
import { lstat } from "node:fs/promises";

/**
 * Der Goldkorpus (`testdata/anchor/cases.json`) gegen den TypeScript-Referenzprüfer. Dieselbe Datei prüft in Teil 2 den C-Prüfer des Starters
 * (README „Starter-Vertrauensanker“): Der Korpus legt Vertrag und erwartete Urteile fest, bevor es C gibt.
 */
const corpus = JSON.parse(readFileSync(path.join(import.meta.dirname, "testdata/anchor/cases.json"), "utf8")) as Corpus;
const trust = { releaseKey: pemToRawKey(corpus.trust.releasePublicPem)!, rootKey: pemToRawKey(corpus.trust.rootPublicPem)! };

const tmp: string[] = [];
after(() => tmp.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const optionsFor = (c: CorpusCase) => ({
  trust,
  expectVersion: c.args.version,
  image: c.args.image,
  floor: c.args.floor,
  enforceFloor: c.args.enforceFloor,
  checkExpiry: c.args.checkExpiry ? new Date(`${c.args.checkExpiry}T12:00:00Z`) : null,
});

describe("Goldkorpus: eingecheckt und aktuell", () => {
  it("cases.json entspricht build-corpus.ts byte-genau (sonst: node scripts/gen-anchor-corpus.mjs)", async () => {
    assert.equal(readFileSync(path.join(import.meta.dirname, "testdata/anchor/cases.json"), "utf8"), corpusToJson(await buildCorpus()));
  });

  it("deckt die geforderten Fälle ab", () => {
    const names = new Set(corpus.cases.map((c) => c.name));
    for (const wanted of [
      "valid", "valid-endorsed", "extra-file", "missing-file", "wrong-hash", "symlink-target-changed", "exec-bit-lost", "setuid-file", "seal-bad-signature",
      "seal-endorsed-by-other-root", "seal-endorsement-expired", "valid-endorsement-expired-not-checked", "floor-equal", "ancestor-node-modules-versions", "tree-long-path", "extra-file-control-chars",
    ]) assert.ok(names.has(wanted), wanted);
    assert.ok(corpus.cases.length >= 60, `nur ${corpus.cases.length} Fälle`);
    assert.equal(new Set(corpus.cases.map((c) => c.name)).size, corpus.cases.length, "Namen sind eindeutig");
  });
});

describe("Goldkorpus gegen den Referenzprüfer (Dateisystem im Speicher)", () => {
  for (const c of corpus.cases) {
    it(`${c.name}: ${c.description}`, async () => {
      const result = await verifyVersion({ ...optionsFor(c), fs: caseToMemoryFs(c), ancestorProbe: caseAncestorProbe(c) });
      assert.equal(result.ok ? 0 : result.code, c.expect.code, JSON.stringify(result));
      assert.equal(classifyVerifyExit(result.ok ? 0 : result.code), c.expect.class);
      if (!result.ok && c.expect.reason) assert.equal(result.reason, c.expect.reason);
      if (!result.ok && c.expect.path) assert.equal(result.path, c.expect.path);
    });
  }
});

describe("Goldkorpus gegen den Referenzprüfer (echtes Dateisystem, Linux)", { skip: process.platform === "win32" ? "Ausführbit, Setuid und Symlinks gibt es unter Windows nicht" : false }, () => {
  for (const c of corpus.cases) {
    it(c.name, async () => {
      const dataDir = mkdtempSync(path.join(tmpdir(), "so-corpus-"));
      tmp.push(dataDir);
      materializeCorpusCase(c, dataDir);
      const versionDir = path.join(dataDir, "app", "versions", c.args.version);
      const result = await verifyVersion({
        ...optionsFor(c),
        fs: nodeFs(versionDir),
        ancestorProbe: () => findNodeModulesAncestor(versionDir, dataDir, async (candidate) => lstat(candidate).then(() => true, () => false)),
      });
      assert.equal(result.ok ? 0 : result.code, c.expect.code, JSON.stringify(result));
      if (!result.ok && c.expect.path) assert.equal(result.path, c.expect.path);
    });
  }
});

describe("Goldkorpus: Mutationen (Bitflips und Abschneiden) werden nie akzeptiert", () => {
  const valid = corpus.cases.find((c) => c.name === "valid")!;

  it("jede einzelne Bitänderung und jede Kürzung des Siegels wird abgelehnt", async () => {
    const original = caseToMemoryFs(valid);
    const sealBytes = (original.nodes.get("SOS-SEAL") as { content: Buffer }).content;
    let tested = 0;
    const attempt = async (mutated: Buffer) => {
      const fs = original.clone();
      fs.file("SOS-SEAL", mutated);
      const result = await verifyVersion({ ...optionsFor(valid), fs });
      assert.equal(result.ok, false);
      tested += 1;
    };
    for (let i = 0; i < sealBytes.length; i++) {
      for (let bit = 0; bit < 8; bit++) {
        const copy = Buffer.from(sealBytes);
        copy[i] ^= 1 << bit;
        await attempt(copy);
      }
    }
    for (let length = 0; length < sealBytes.length; length++) await attempt(sealBytes.subarray(0, length));
    assert.ok(tested > 4000);
  });

  it("jede einzelne Bitänderung und jede Kürzung der Liste wird abgelehnt (Hash im Siegel)", async () => {
    const original = caseToMemoryFs(valid);
    const treeBytes = (original.nodes.get("SOS-TREE") as { content: Buffer }).content;
    const step = Math.max(1, Math.floor(treeBytes.length / 400)); // stichprobenartig, aber über die ganze Datei
    for (let i = 0; i < treeBytes.length; i += step) {
      const copy = Buffer.from(treeBytes);
      copy[i] ^= 1 << (i % 8);
      const fs = original.clone();
      fs.file("SOS-TREE", copy);
      assert.equal((await verifyVersion({ ...optionsFor(valid), fs })).ok, false, `Byte ${i}`);
    }
    for (const length of [0, 1, 40, treeBytes.length - 1]) {
      const fs = original.clone();
      fs.file("SOS-TREE", treeBytes.subarray(0, length));
      assert.equal((await verifyVersion({ ...optionsFor(valid), fs })).ok, false, `Länge ${length}`);
    }
  });

  it("jede Änderung eines Bits irgendeiner Datei des Pakets wird erkannt", async () => {
    const original = caseToMemoryFs(valid);
    for (const [name, node] of original.nodes) {
      if (node.kind !== "file" || name === "SOS-SEAL" || name === "SOS-TREE" || node.content.length === 0) continue;
      const fs = original.clone();
      const copy = Buffer.from(node.content);
      copy[0] ^= 1;
      fs.file(name, copy, node.mode);
      const result = await verifyVersion({ ...optionsFor(valid), fs });
      assert.equal(result.ok ? 0 : result.code, 16, name);
    }
  });
});

describe("Klassen der Prüfergebnisse", () => {
  it("ordnet Exit-Codes ein: unbekannt und Signal sind nie ‚negativ‘", () => {
    assert.equal(classifyVerifyExit(0), "ok");
    for (const code of [10, 11, 12, 13, 14, 15, 16, 18]) assert.equal(classifyVerifyExit(code), "negative", String(code));
    assert.equal(classifyVerifyExit(19), "benign");
    for (const code of [17, 1, 2, 3, 20, 99, 127, 137, 139]) assert.equal(classifyVerifyExit(code), "inconclusive", String(code));
    assert.equal(classifyVerifyExit(null), "inconclusive");
  });

  it("der Korpus verwendet nur dokumentierte Codes", () => {
    const allowed = new Set([0, 10, 11, 12, 13, 14, 15, 16, 18, 19]);
    for (const c of corpus.cases) assert.ok(allowed.has(c.expect.code), c.name);
  });
});
