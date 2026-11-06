import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";
import { UpdateError, needsNewImage, verifyManifest, type Manifest } from "./manifest";

const pair = generateKeyPairSync("ed25519");
const other = generateKeyPairSync("ed25519");
const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();

const manifest: Manifest = {
  schema: 1,
  version: "1.2.3",
  base: 1,
  arch: "x64",
  asset: "schrauberos-1.2.3.tar.gz",
  sha256: "b".repeat(64),
  size: 1234,
};
const bytes = Buffer.from(JSON.stringify(manifest));
const signed = (data: Buffer, key = pair.privateKey) => sign(null, data, key);

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof UpdateError ? e.code : "other";
  }
  return null;
};

describe("Release-Manifest", () => {
  it("akzeptiert ein korrekt signiertes Manifest", () => {
    assert.deepEqual(verifyManifest(bytes, signed(bytes), publicPem), manifest);
  });

  it("lehnt eine Signatur mit fremdem Schlüssel ab", () => {
    assert.equal(codeOf(() => verifyManifest(bytes, signed(bytes, other.privateKey), publicPem)), "badSignature");
  });

  it("lehnt ein verändertes Manifest ab", () => {
    const tampered = Buffer.from(JSON.stringify({ ...manifest, sha256: "c".repeat(64) }));
    assert.equal(codeOf(() => verifyManifest(tampered, signed(bytes), publicPem)), "badSignature");
  });

  it("lehnt kaputte Signaturen und Schlüssel ab", () => {
    assert.equal(codeOf(() => verifyManifest(bytes, Buffer.from("zu kurz"), publicPem)), "badSignature");
    assert.equal(codeOf(() => verifyManifest(bytes, signed(bytes), "kein pem")), "badSignature");
  });

  it("lehnt signierte, aber ungültige Manifeste ab (z. B. Pfad in der Version)", () => {
    for (const bad of [{ ...manifest, version: "../../x" }, { ...manifest, asset: "../evil.tar.gz" }, { ...manifest, size: -1 }, { ...manifest, schema: 2 }]) {
      const b = Buffer.from(JSON.stringify(bad));
      assert.equal(codeOf(() => verifyManifest(b, signed(b), publicPem)), "badRelease");
    }
  });

  it("erkennt, wann ein neues Image nötig ist", () => {
    const running = { version: "1.0.0", base: 1, arch: process.arch };
    assert.equal(needsNewImage({ ...manifest, arch: process.arch }, running), false);
    assert.equal(needsNewImage({ ...manifest, base: 2 }, running), true);
    assert.equal(needsNewImage({ ...manifest, arch: process.arch === "x64" ? "arm64" : "x64" }, running), true);
  });
});
