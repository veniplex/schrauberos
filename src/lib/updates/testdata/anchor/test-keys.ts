/**
 * TESTSCHLÜSSEL – NUR FÜR TESTS, OHNE JEDEN WERT. Ableitbar aus festen Zeichenketten, also öffentlich bekannt: Niemals als echte Schlüssel verwenden, nie in
 * `release-key.ts` oder ein Secret eintragen. Sie machen den Goldkorpus (`cases.json`) reproduzierbar (Ed25519 ist deterministisch) und dienen dem Prüfer-Testbinary
 * des Starters (Teil 2) als Vertrauensanker. Ein Tag-Build bricht ab, wenn er diese Schlüssel enthält (`scripts/gen-trust-header.mjs`).
 */
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { pemToRawKey } from "../../keychain.ts";

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export type TestKey = { name: string; privatePem: string; publicPem: string; publicHex: string };

function derive(name: string): TestKey {
  const seed = createHash("sha256").update(`SchrauberOS TEST ONLY key: ${name}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  const publicPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  return { name, privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicPem, publicHex: pemToRawKey(publicPem)!.toString("hex") };
}

export const TEST_ROOT = derive("root");
export const TEST_RELEASE = derive("release");
export const TEST_SECOND = derive("second release key (endorsed)");
export const TEST_ROGUE = derive("rogue");
export const TEST_OTHER_ROOT = derive("other root");
