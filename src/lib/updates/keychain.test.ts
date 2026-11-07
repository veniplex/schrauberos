import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, it } from "node:test";
import {
  createEndorsement,
  ENDORSEMENT_CONTEXT,
  ENDORSEMENT_STATEMENT_BYTES,
  endorsementStatement,
  isCalendarDate,
  MANIFEST_CONTEXT,
  manifestSignedBytes,
  parseEndorsements,
  parseEndorsementStatement,
  pemToRawKey,
  rawKeyToPem,
  rootKeyProblem,
  trustedReleaseKeys,
  validEndorsements,
  verifyEndorsement,
} from "./keychain";

const pem = (k: KeyObject) => k.export({ type: "spki", format: "pem" }).toString();
const priv = (k: KeyObject) => k.export({ type: "pkcs8", format: "pem" }).toString();

const root = generateKeyPairSync("ed25519");
const old = generateKeyPairSync("ed25519"); // eingebauter Release-Schlüssel
const fresh = generateKeyPairSync("ed25519"); // neuer, beglaubigter Release-Schlüssel
const rogue = generateKeyPairSync("ed25519"); // nicht beglaubigt
const fakeRoot = generateKeyPairSync("ed25519");

/** Beglaubigung mit beliebigen Aussage-Bytes (für Formatfehler), korrekt vom Wurzelschlüssel signiert. */
const signedStatement = (statement: Buffer, signer = root, context = ENDORSEMENT_CONTEXT) => ({
  statement: statement.toString("base64"),
  signature: sign(null, Buffer.concat([Buffer.from(context), statement]), priv(signer.privateKey)).toString("base64"),
});
const hex = (k: { publicKey: KeyObject }) => pemToRawKey(pem(k.publicKey))!.toString("hex");

describe("Schlüssel PEM ↔ roh", () => {
  it("wandelt hin und zurück und prüft das SPKI-Präfix", () => {
    const raw = pemToRawKey(pem(fresh.publicKey))!;
    assert.equal(raw.length, 32);
    assert.equal(rawKeyToPem(raw), pem(fresh.publicKey));
    // kein Ed25519 (RSA) oder Müll: kein roher Schlüssel
    assert.equal(pemToRawKey(pem(generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey)), null);
    assert.equal(pemToRawKey("kein pem"), null);
    assert.equal(pemToRawKey(pem(generateKeyPairSync("x25519").publicKey)), null, "X25519 hat ein anderes Präfix");
  });
});

describe("Beglaubigung (Format 2)", () => {
  it("hat genau die dokumentierte Form und feste Länge", () => {
    const statement = endorsementStatement(hex(fresh), "2031-12-31");
    assert.equal(statement.length, ENDORSEMENT_STATEMENT_BYTES);
    assert.equal(statement.length, 118);
    assert.equal(statement.toString("utf8"), `schrauberos-endorsement 2\nkey ${hex(fresh)}\nvalid-until 2031-12-31\n`);
    assert.deepEqual(parseEndorsementStatement(statement), { key: Buffer.from(hex(fresh), "hex"), validUntil: "2031-12-31" });
  });

  it("lehnt jede Abweichung der Aussage ab (Länge, Großbuchstaben, Zeilenende, Zusatzzeile, Datum, Magie)", () => {
    const good = endorsementStatement(hex(fresh), "2031-12-31").toString("utf8");
    const bad = [
      good.toUpperCase(),
      good.replace(/\n/g, "\r\n"),
      good + "extra 1\n",
      good.slice(0, -1),
      good.replace("2031-12-31", "2031-02-30"),
      good.replace("2031-12-31", "31.12.2031"),
      good.replace("endorsement 2", "endorsement 1"),
      good.replace(hex(fresh), hex(fresh).toUpperCase()),
      good.replace("key ", "key  "),
      good.replace("valid-until", "valid-until:"),
    ];
    for (const text of bad) assert.equal(parseEndorsementStatement(Buffer.from(text)), null, JSON.stringify(text.slice(0, 40)));
    for (const text of bad) assert.equal(verifyEndorsement(signedStatement(Buffer.from(text)), pem(root.publicKey), null), null);
  });

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
    const tampered = { ...endorsement, statement: endorsementStatement(hex(rogue), "2099-12-31").toString("base64") };
    assert.equal(verifyEndorsement(tampered, pem(root.publicKey)), null);
  });

  it("eine Signatur mit anderem Kontext (Manifest, v1) ist keine Beglaubigung", () => {
    const statement = endorsementStatement(hex(rogue), "2099-12-31");
    assert.equal(verifyEndorsement(signedStatement(statement, root, MANIFEST_CONTEXT), pem(root.publicKey)), null);
    assert.equal(verifyEndorsement(signedStatement(statement, root, "schrauberos-release-key-endorsement-v1\n"), pem(root.publicKey)), null);
    assert.equal(verifyEndorsement({ statement: statement.toString("base64"), signature: sign(null, statement, priv(root.privateKey)).toString("base64") }, pem(root.publicKey)), null);
    assert.equal(verifyEndorsement(signedStatement(statement), pem(root.publicKey)), pem(rogue.publicKey), "mit dem richtigen Kontext gilt sie");
  });

  it("abgelaufene Beglaubigungen gelten nicht – es sei denn, der Aufrufer prüft den Ablauf nicht (Starter)", () => {
    const limited = createEndorsement(priv(root.privateKey), pem(fresh.publicKey), "2030-01-31");
    assert.equal(verifyEndorsement(limited, pem(root.publicKey), new Date("2030-01-31T12:00:00Z")), pem(fresh.publicKey));
    assert.equal(verifyEndorsement(limited, pem(root.publicKey), new Date("2030-02-01T00:00:00Z")), null);
    assert.equal(verifyEndorsement(limited, pem(root.publicKey), null), pem(fresh.publicKey), "now = null: Ablauf nicht geprüft");
  });

  it("eine Beglaubigung ohne Ablaufdatum gilt nicht (validUntil ist Pflicht); sie lässt sich auch nicht erzeugen", () => {
    const withoutDate = Buffer.from(`schrauberos-endorsement 2\nkey ${hex(fresh)}\n`);
    assert.equal(verifyEndorsement(signedStatement(withoutDate), pem(root.publicKey)), null);
    assert.equal(verifyEndorsement(signedStatement(Buffer.from(`schrauberos-endorsement 2\nkey ${hex(fresh)}\nvalid-until irgendwann\n`)), pem(root.publicKey)), null);
    assert.throws(() => createEndorsement(priv(root.privateKey), pem(fresh.publicKey), ""), /validUntil/);
    assert.throws(() => createEndorsement(priv(root.privateKey), pem(fresh.publicKey), "2031-02-30"), /validUntil/);
    assert.throws(() => createEndorsement(priv(root.privateKey), pem(fresh.publicKey), undefined as unknown as string), /validUntil/);
  });

  it("isCalendarDate kennt nur echte Kalendertage", () => {
    assert.equal(isCalendarDate("2028-02-29"), true);
    assert.equal(isCalendarDate("2029-02-29"), false);
    assert.equal(isCalendarDate("2029-13-01"), false);
    assert.equal(isCalendarDate("2029-1-1"), false);
    assert.equal(isCalendarDate(20290101), false);
    // Schaltjahre nach dem gregorianischen Kalender, auch Jahre unter 100 (der C-Prüfer rechnet genauso)
    assert.equal(isCalendarDate("2000-02-29"), true);
    assert.equal(isCalendarDate("2100-02-29"), false);
    assert.equal(isCalendarDate("0000-02-29"), true);
    assert.equal(isCalendarDate("0050-02-29"), false);
    assert.equal(isCalendarDate("0096-02-29"), true);
    assert.equal(isCalendarDate("2026-04-31"), false);
    assert.equal(isCalendarDate("2026-00-10"), false);
    assert.equal(isCalendarDate("2026-12-00"), false);
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

describe("Manifest-Kontext", () => {
  it("stellt dem Manifest einen festen Kontext voran (Sec F14)", () => {
    assert.equal(MANIFEST_CONTEXT, "schrauberos-manifest-v1\n");
    assert.equal(manifestSignedBytes(Buffer.from("{}")).toString("utf8"), "schrauberos-manifest-v1\n{}");
  });
});
