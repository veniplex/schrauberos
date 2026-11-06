import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, it } from "node:test";
import { createEndorsement, parseEndorsements, trustedReleaseKeys, validEndorsements, verifyEndorsement } from "./keychain";

const pem = (k: KeyObject) => k.export({ type: "spki", format: "pem" }).toString();
const priv = (k: KeyObject) => k.export({ type: "pkcs8", format: "pem" }).toString();

const root = generateKeyPairSync("ed25519");
const old = generateKeyPairSync("ed25519"); // eingebauter Release-Schlüssel
const fresh = generateKeyPairSync("ed25519"); // neuer, beglaubigter Release-Schlüssel
const rogue = generateKeyPairSync("ed25519"); // nicht beglaubigt
const fakeRoot = generateKeyPairSync("ed25519");

describe("Schlüsselkette", () => {
  const endorsement = createEndorsement(priv(root.privateKey), pem(fresh.publicKey));

  it("vertraut dem eingebauten Schlüssel und einem vom Wurzelschlüssel beglaubigten", () => {
    const keys = trustedReleaseKeys({ root: pem(root.publicKey), builtIn: [pem(old.publicKey)], endorsements: [endorsement] });
    assert.equal(keys.length, 2);
    assert.ok(keys.includes(pem(fresh.publicKey)));
  });

  it("ein nicht beglaubigter Schlüssel wird nicht aufgenommen", () => {
    const selfSigned = createEndorsement(priv(rogue.privateKey), pem(rogue.publicKey));
    const byFakeRoot = createEndorsement(priv(fakeRoot.privateKey), pem(rogue.publicKey));
    const keys = trustedReleaseKeys({ root: pem(root.publicKey), builtIn: [pem(old.publicKey)], endorsements: [selfSigned, byFakeRoot] });
    assert.deepEqual(keys, [pem(old.publicKey)]);
  });

  it("eine veränderte Aussage (anderer Schlüssel) macht die Beglaubigung ungültig", () => {
    const tampered = { ...endorsement, statement: Buffer.from(JSON.stringify({ schema: 1, publicKey: pem(rogue.publicKey) })).toString("base64") };
    assert.equal(verifyEndorsement(tampered, pem(root.publicKey)), null);
  });

  it("eine Manifest-Signatur des Wurzelschlüssels ist keine Beglaubigung (Kontext-Präfix)", () => {
    const statement = Buffer.from(JSON.stringify({ schema: 1, publicKey: pem(rogue.publicKey) }));
    const withoutContext = { statement: statement.toString("base64"), signature: sign(null, statement, priv(root.privateKey)).toString("base64") };
    assert.equal(verifyEndorsement(withoutContext, pem(root.publicKey)), null);
  });

  it("abgelaufene Beglaubigungen gelten nicht", () => {
    const limited = createEndorsement(priv(root.privateKey), pem(fresh.publicKey), "2030-01-31");
    assert.equal(verifyEndorsement(limited, pem(root.publicKey), new Date("2030-01-31T12:00:00Z")), pem(fresh.publicKey));
    assert.equal(verifyEndorsement(limited, pem(root.publicKey), new Date("2030-02-01T00:00:00Z")), null);
  });

  it("parseEndorsements verträgt Müll; validEndorsements entfernt Ungültige und Doppelte", () => {
    assert.deepEqual(parseEndorsements(null), []);
    assert.deepEqual(parseEndorsements({ keys: [{ statement: 1 }, "x", endorsement] }), [endorsement]);
    assert.deepEqual(validEndorsements([endorsement, endorsement, { statement: "AAAA", signature: "BBBB" }], pem(root.publicKey)), [endorsement]);
  });
});
