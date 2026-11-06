import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, it } from "node:test";
import { createEndorsement, ENDORSEMENT_CONTEXT, parseEndorsements, rootKeyProblem, trustedReleaseKeys, validEndorsements, verifyEndorsement } from "./keychain";

const pem = (k: KeyObject) => k.export({ type: "spki", format: "pem" }).toString();
const priv = (k: KeyObject) => k.export({ type: "pkcs8", format: "pem" }).toString();

const root = generateKeyPairSync("ed25519");
const old = generateKeyPairSync("ed25519"); // eingebauter Release-Schlüssel
const fresh = generateKeyPairSync("ed25519"); // neuer, beglaubigter Release-Schlüssel
const rogue = generateKeyPairSync("ed25519"); // nicht beglaubigt
const fakeRoot = generateKeyPairSync("ed25519");

describe("Schlüsselkette", () => {
  const endorsement = createEndorsement(priv(root.privateKey), pem(fresh.publicKey), "2099-12-31");

  it("vertraut dem eingebauten Schlüssel und einem vom Wurzelschlüssel beglaubigten", () => {
    const keys = trustedReleaseKeys({ root: pem(root.publicKey), builtIn: [pem(old.publicKey)], endorsements: [endorsement] });
    assert.equal(keys.length, 2);
    assert.ok(keys.includes(pem(fresh.publicKey)));
  });

  it("ein nicht beglaubigter Schlüssel wird nicht aufgenommen", () => {
    const selfSigned = createEndorsement(priv(rogue.privateKey), pem(rogue.publicKey), "2099-12-31");
    const byFakeRoot = createEndorsement(priv(fakeRoot.privateKey), pem(rogue.publicKey), "2099-12-31");
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

  it("eine Beglaubigung ohne Ablaufdatum gilt nicht (validUntil ist Pflicht); sie lässt sich auch nicht erzeugen", () => {
    const statement = Buffer.from(JSON.stringify({ schema: 1, publicKey: pem(fresh.publicKey) }));
    const unlimited = { statement: statement.toString("base64"), signature: sign(null, Buffer.concat([Buffer.from(ENDORSEMENT_CONTEXT), statement]), priv(root.privateKey)).toString("base64") };
    assert.equal(verifyEndorsement(unlimited, pem(root.publicKey)), null);
    const badDate = Buffer.from(JSON.stringify({ schema: 1, publicKey: pem(fresh.publicKey), validUntil: "irgendwann" }));
    const withBadDate = { statement: badDate.toString("base64"), signature: sign(null, Buffer.concat([Buffer.from(ENDORSEMENT_CONTEXT), badDate]), priv(root.privateKey)).toString("base64") };
    assert.equal(verifyEndorsement(withBadDate, pem(root.publicKey)), null);
    assert.throws(() => createEndorsement(priv(root.privateKey), pem(fresh.publicKey), ""), /validUntil/);
    assert.throws(() => createEndorsement(priv(root.privateKey), pem(fresh.publicKey), undefined as unknown as string), /validUntil/);
  });

  it("der eingebaute Release-Schlüssel bleibt vertraut, auch wenn ein anderer beglaubigt wird (Rotation ersetzt kein Widerrufen)", () => {
    const keys = trustedReleaseKeys({ root: pem(root.publicKey), builtIn: [pem(old.publicKey)], endorsements: [endorsement] });
    assert.ok(keys.includes(pem(old.publicKey)), "der alte, eingebaute Schlüssel gilt weiter");
  });

  it("rootKeyProblem: fehlender oder mit dem Release-Schlüssel identischer Wurzelschlüssel ist ein Problem", () => {
    assert.equal(rootKeyProblem(pem(old.publicKey), undefined), "root-missing");
    assert.equal(rootKeyProblem(pem(old.publicKey), pem(old.publicKey)), "root-equals-release");
    assert.equal(rootKeyProblem(pem(old.publicKey), pem(root.publicKey)), null);
  });

  it("parseEndorsements verträgt Müll; validEndorsements entfernt Ungültige und Doppelte", () => {
    assert.deepEqual(parseEndorsements(null), []);
    assert.deepEqual(parseEndorsements({ keys: [{ statement: 1 }, "x", endorsement] }), [endorsement]);
    assert.deepEqual(validEndorsements([endorsement, endorsement, { statement: "AAAA", signature: "BBBB" }], pem(root.publicKey)), [endorsement]);
  });
});
