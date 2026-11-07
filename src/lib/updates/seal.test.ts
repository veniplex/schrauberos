import assert from "node:assert/strict";
import { sign } from "node:crypto";
import { describe, it } from "node:test";
import { createEndorsement, endorsementStatement } from "./keychain.ts";
import { createSeal, findNodeModulesAncestor, SEAL_CONTEXT, SEAL_MAX_BYTES, SEAL_TAIL_A, SEAL_TAIL_B, sealFieldsFor, verifySeal, verifyVersion } from "./seal.ts";
import { generateTree, serializeTree, sha512Hex } from "./tree.ts";
import { MemoryFs } from "./tree-testkit.ts";
import { TEST_OTHER_ROOT, TEST_RELEASE, TEST_ROGUE, TEST_ROOT, TEST_SECOND } from "./testdata/anchor/test-keys.ts";
import { pemToRawKey } from "./keychain.ts";

const trust = { releaseKey: pemToRawKey(TEST_RELEASE.publicPem)!, rootKey: pemToRawKey(TEST_ROOT.publicPem)! };
const tree = serializeTree([{ type: "f", exec: false, size: 3, hash: "c".repeat(128), path: "x" }]);
const fields = sealFieldsFor(tree, { version: "1.2.3", base: 4, arch: "x64" });
const endorsement = (until = "2099-12-31", signer = TEST_ROOT) => createEndorsement(signer.privatePem, TEST_SECOND.publicPem, until);
const sealA = () => createSeal(fields, TEST_RELEASE.privatePem, { builtInKeyPem: TEST_RELEASE.publicPem });
const sealB = (until?: string, root = TEST_ROOT) => createSeal(fields, TEST_SECOND.privatePem, { builtInKeyPem: TEST_RELEASE.publicPem, endorsement: endorsement(until, root) });

describe("SOS-SEAL: Aufbau", () => {
  it("Form A hat genau die dokumentierte Gestalt, der Schwanz ist 216 Bytes lang", () => {
    const text = sealA().toString("utf8");
    const lines = text.split("\n");
    assert.equal(lines.length, 11);
    assert.deepEqual(lines.slice(0, 8).map((l) => l.split(" ")[0]), ["schrauberos-seal", "version", "base", "arch", "tree-sha512", "tree-size", "tree-entries", "tree-bytes"]);
    assert.equal(lines[8], `signing-key ${TEST_RELEASE.publicHex}`);
    assert.match(lines[9], /^signature [0-9a-f]{128}$/);
    assert.equal(lines[10], "");
    assert.equal(SEAL_TAIL_A, 216);
    assert.equal(text.slice(text.length - SEAL_TAIL_A).startsWith("signing-key "), true);
    assert.equal(lines[1], "version 1.2.3");
    assert.equal(lines[5], `tree-size ${tree.length}`);
    assert.equal(lines[4], `tree-sha512 ${sha512Hex(tree)}`);
  });

  it("Form B trägt die Beglaubigung (118 Bytes → 236 Hexziffern); der Schwanz ist 610 Bytes lang", () => {
    const text = sealB().toString("utf8");
    const lines = text.split("\n");
    assert.equal(SEAL_TAIL_B, 610);
    assert.deepEqual(lines.slice(8, 12).map((l) => l.split(" ")[0]), ["signing-key", "endorsement", "endorsement-sig", "signature"]);
    assert.equal(lines[9].length, "endorsement ".length + 236);
    assert.equal(Buffer.from(lines[9].slice(12), "hex").toString(), endorsementStatement(TEST_SECOND.publicHex, "2099-12-31").toString());
  });

  it("createSeal verweigert unvollständige oder widersprüchliche Angaben", () => {
    assert.throws(() => createSeal(fields, TEST_SECOND.privatePem, { builtInKeyPem: TEST_RELEASE.publicPem }), /Beglaubigung/);
    assert.throws(() => createSeal(fields, TEST_RELEASE.privatePem, { builtInKeyPem: TEST_RELEASE.publicPem, endorsement: endorsement() }), /keine Beglaubigung/);
    assert.throws(() => createSeal(fields, TEST_ROGUE.privatePem, { builtInKeyPem: TEST_RELEASE.publicPem, endorsement: endorsement() }), /anderen Schlüssel/);
    assert.throws(() => createSeal({ ...fields, version: "1.2.3-dev" }, TEST_RELEASE.privatePem, { builtInKeyPem: TEST_RELEASE.publicPem }), /Version/);
    assert.throws(() => createSeal({ ...fields, version: "01.2.3" }, TEST_RELEASE.privatePem, { builtInKeyPem: TEST_RELEASE.publicPem }), /Version/);
    assert.throws(() => createSeal({ ...fields, arch: "X64" }, TEST_RELEASE.privatePem, { builtInKeyPem: TEST_RELEASE.publicPem }), /arch/);
    assert.throws(() => createSeal({ ...fields, treeSize: -1 }, TEST_RELEASE.privatePem, { builtInKeyPem: TEST_RELEASE.publicPem }), /tree-size/);
  });
});

describe("SOS-SEAL: Prüfen (erst prüfen, dann lesen)", () => {
  it("akzeptiert beide Formen und liefert die Felder", () => {
    const a = verifySeal(sealA(), trust, null);
    assert.ok(a.ok && a.seal.version === "1.2.3" && a.seal.base === 4 && a.seal.arch === "x64" && a.seal.treeEntries === 1 && a.seal.endorsedUntil === undefined);
    const b = verifySeal(sealB(), trust, new Date("2026-11-07T00:00:00Z"));
    assert.ok(b.ok && b.seal.signingKey === TEST_SECOND.publicHex && b.seal.endorsedUntil === "2099-12-31");
  });

  it("Ablauf: nur mit Datum geprüft (Starter prüft ihn nicht)", () => {
    const seal = sealB("2026-01-31");
    assert.equal(verifySeal(seal, trust, null).ok, true);
    assert.deepEqual(verifySeal(seal, trust, new Date("2026-11-07T00:00:00Z")), { ok: false, code: 11, reason: "endorsement-expired" });
    assert.equal(verifySeal(seal, trust, new Date("2026-01-31T23:00:00Z")).ok, true, "am Ablauftag noch gültig");
  });

  it("lehnt ab: fremde Wurzel, fremder Schlüssel, Beglaubigung für den Release-Schlüssel, falschen Kontext, andere Schlüssel in Aussage und Siegel", () => {
    assert.deepEqual(verifySeal(sealB(undefined, TEST_OTHER_ROOT), trust, null), { ok: false, code: 11, reason: "endorsement-invalid" });
    const rogueA = Buffer.from(sealA().toString().replace(TEST_RELEASE.publicHex, TEST_ROGUE.publicHex));
    assert.deepEqual(verifySeal(rogueA, trust, null), { ok: false, code: 11, reason: "unknown-key" });
    // Beglaubigung des Release-Schlüssels selbst in Form B: verboten
    const forRelease = createEndorsement(TEST_ROOT.privatePem, TEST_RELEASE.publicPem, "2099-12-31");
    const text = sealA().toString();
    const insert = `endorsement ${Buffer.from(forRelease.statement, "base64").toString("hex")}\nendorsement-sig ${Buffer.from(forRelease.signature, "base64").toString("hex")}\n`;
    const forged = Buffer.from(text.replace("signature ", insert + "signature "));
    assert.deepEqual(verifySeal(forged, trust, null), { ok: false, code: 11, reason: "endorsement-for-release-key" });
    // Siegel-Signatur ohne Kontext
    const body = sealA().subarray(0, sealA().length - 139);
    const noContext = Buffer.concat([body, Buffer.from(`signature ${sign(null, body, TEST_RELEASE.privatePem).toString("hex")}\n`)]);
    assert.deepEqual(verifySeal(noContext, trust, null), { ok: false, code: 11, reason: "bad-signature" });
    const withContext = Buffer.concat([body, Buffer.from(`signature ${sign(null, Buffer.concat([Buffer.from(SEAL_CONTEXT), body]), TEST_RELEASE.privatePem).toString("hex")}\n`)]);
    assert.equal(verifySeal(withContext, trust, null).ok, true);
    // Beglaubigung für einen anderen Schlüssel als signing-key
    const otherStatement = createEndorsement(TEST_ROOT.privatePem, TEST_ROGUE.publicPem, "2099-12-31");
    const swapped = sealB().toString().replace(/endorsement [0-9a-f]+\nendorsement-sig [0-9a-f]+\n/, `endorsement ${Buffer.from(otherStatement.statement, "base64").toString("hex")}\nendorsement-sig ${Buffer.from(otherStatement.signature, "base64").toString("hex")}\n`);
    assert.deepEqual(verifySeal(Buffer.from(swapped), trust, null), { ok: false, code: 11, reason: "endorsement-other-key" });
  });

  it("formale Fehler vor der Signaturprüfung sind Code 10; ein gültig signierter, aber fehlerhafter Rumpf ebenfalls", () => {
    for (const bad of [Buffer.alloc(0), Buffer.from("x\n"), Buffer.alloc(SEAL_MAX_BYTES + 1, 0x61), sealA().subarray(0, 100), Buffer.concat([sealA(), Buffer.from("\n")])]) {
      assert.equal((verifySeal(bad, trust, null) as { code: number }).code, 10);
    }
    const signedBody = (body: string) => {
      const part = Buffer.from(`${body}signing-key ${TEST_RELEASE.publicHex}\n`);
      return Buffer.concat([part, Buffer.from(`signature ${sign(null, Buffer.concat([Buffer.from(SEAL_CONTEXT), part]), TEST_RELEASE.privatePem).toString("hex")}\n`)]);
    };
    const good = sealA().toString().split("signing-key")[0];
    assert.equal(verifySeal(signedBody(good), trust, null).ok, true, "Gegenprobe: so gebaut ist es gültig");
    for (const body of [
      good.replace("version 1.2.3", "version 1.2"),
      good.replace("version 1.2.3", "version 1.2.3-dev"),
      good.replace("base 4", "base 0"),
      good.replace("base 4", "base 04"),
      good.replace("arch x64", "arch X64"),
      good.replace("tree-size", "tree_size"),
      good.replace("base 4\narch x64\n", "arch x64\nbase 4\n"),
      good + "extra 1\n",
      good.replace(/tree-bytes \d+\n/, ""),
      good.replace(/tree-entries \d+/, "tree-entries 99999999999999999999"),
      good.replace(/tree-entries \d+/, "tree-entries 200001"),
    ]) assert.equal((verifySeal(signedBody(body), trust, null) as { code: number }).code, 10, body.slice(0, 120));
  });

  it("jedes Byte und jede Länge: keine Änderung wird akzeptiert (Form A und B)", () => {
    for (const seal of [sealA(), sealB()]) {
      for (let i = 0; i < seal.length; i++) {
        const copy = Buffer.from(seal);
        copy[i] ^= 0x01;
        assert.equal(verifySeal(copy, trust, null).ok, false, `Byte ${i}`);
      }
      for (let n = 0; n < seal.length; n++) assert.equal(verifySeal(seal.subarray(0, n), trust, null).ok, false, `Länge ${n}`);
    }
  });
});

describe("Referenzprüfer verifyVersion", () => {
  const pkg = async (signer = TEST_RELEASE, version = "1.2.3") => {
    const fs = new MemoryFs().file("a.js", "x").file("bin", "y", 0o755);
    const t = serializeTree(await generateTree(fs));
    fs.file("SOS-TREE", t);
    fs.file("SOS-SEAL", createSeal(sealFieldsFor(t, { version, base: 4, arch: "x64" }), signer.privatePem, { builtInKeyPem: TEST_RELEASE.publicPem, endorsement: signer === TEST_RELEASE ? undefined : endorsement() }));
    return fs;
  };
  const opts = (fs: MemoryFs, extra = {}) => ({ fs, trust, expectVersion: "1.2.3", image: { base: 4, arch: "x64" }, ...extra });

  it("meldet Dateien, Bytes, Dauer und den Abstand zur Untergrenze getrennt (Echtprobe: --verify ohne Floor-Zwang)", async () => {
    const fs = await pkg();
    const ok = await verifyVersion(opts(fs, { floor: "1.2.3", enforceFloor: false }));
    assert.ok(ok.ok && ok.files === 2 && ok.bytes === 2 && ok.floor === "equal");
    const below = await verifyVersion(opts(fs, { floor: "2.0.0", enforceFloor: false }));
    assert.ok(below.ok && below.floor === "below");
    const above = await verifyVersion(opts(fs, { floor: "1.0.0" }));
    assert.ok(above.ok && above.floor === "above");
    assert.equal((await verifyVersion(opts(fs, { floor: "1.2.3" }))).ok, false, "mit Zwang: gleich ist nicht größer");
  });

  it("die Reihenfolge entspricht dem Starter: Untergrenze steht vor dem Öffnen von Dateien (auch bei kaputtem Siegel kein Alarm)", async () => {
    const fs = await pkg();
    fs.file("SOS-SEAL", "kaputt");
    const result = await verifyVersion(opts(fs, { floor: "9.0.0" }));
    assert.deepEqual(result, { ok: false, code: 19, reason: "floor" });
  });

  it("Ordnername ungültig oder Vorabversion: Code 12", async () => {
    const fs = await pkg();
    for (const expectVersion of ["../x", "1.2.3-dev.1", "1.2", ""]) assert.equal((await verifyVersion(opts(fs, { expectVersion }))).ok, false, expectVersion);
    assert.equal((await verifyVersion(opts(fs, { expectVersion: "1.2.4" }))).ok ? 0 : 1, 1);
  });

  it("beglaubigter Schlüssel mit Ablaufprüfung", async () => {
    const fs = await pkg(TEST_SECOND);
    assert.equal((await verifyVersion(opts(fs, { checkExpiry: new Date("2030-01-01T00:00:00Z") }))).ok, true);
    assert.equal((await verifyVersion(opts(fs, { checkExpiry: new Date("2100-01-01T00:00:00Z") }))).ok, false);
  });

  it("Ein-/Ausgabefehler beim Hashen: Code 17", async () => {
    const fs = await pkg();
    fs.failing.add("a.js");
    const result = await verifyVersion(opts(fs));
    assert.deepEqual(result, { ok: false, code: 17, reason: "io", path: "a.js" });
  });
});

describe("Vorfahrenregel: node_modules oberhalb der Version", () => {
  const present = (paths: string[]) => async (candidate: string) => paths.includes(candidate);

  it("prüft Versionsordner-Eltern bis einschließlich des Datenverzeichnisses", async () => {
    const dir = "/data/app/versions/1.2.3";
    assert.equal(await findNodeModulesAncestor(dir, "/data", present([])), null);
    assert.equal(await findNodeModulesAncestor(dir, "/data", present(["/data/app/versions/node_modules"])), "/data/app/versions/node_modules");
    assert.equal(await findNodeModulesAncestor(dir, "/data", present(["/data/app/node_modules"])), "/data/app/node_modules");
    assert.equal(await findNodeModulesAncestor(dir, "/data", present(["/data/node_modules"])), "/data/node_modules");
    assert.equal(await findNodeModulesAncestor(dir, "/data/", present(["/node_modules"])), null, "darüber ist das Image (root-eigen) – nicht Teil der Prüfung");
    assert.equal(await findNodeModulesAncestor(dir, "/data", present([`${dir}/node_modules`])), null, "node_modules im Versionsordner selbst gehört zum Baum");
  });

  it("Staging-Ordner unter versions/ und Windows-Pfade; Ordner außerhalb des Datenverzeichnisses werden nicht geprüft", async () => {
    assert.equal(await findNodeModulesAncestor("/data/app/versions/.partial-1.2.3", "/data", present(["/data/app/versions/node_modules"])), "/data/app/versions/node_modules");
    assert.equal(await findNodeModulesAncestor("C:\\data\\app\\versions\\1.2.3", "C:\\data", present(["C:\\data\\app\\versions/node_modules"])), "C:\\data\\app\\versions/node_modules");
    assert.equal(await findNodeModulesAncestor("/elsewhere/1.2.3", "/data", present(["/elsewhere/node_modules"])), null);
  });
});
