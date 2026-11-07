// Erzeugt und signiert das Siegel (SOS-SEAL) einer App-Version (aufgerufen vom Release-Job der Pipeline, mit dem Release-Schlüssel):
//   RELEASE_SIGNING_KEY="<PEM>" node scripts/make-seal.mjs --bundle <entpacktes-paket> --out <ordner>
// Das Paket (`--bundle`) ist das Verzeichnis, das als Release-Paket verpackt wird; es enthält die Dateiliste SOS-TREE (erzeugt im Image-Bau von
// scripts/gen-tree.mjs). Vor dem Signieren wird geprüft, dass Verzeichnis und Liste übereinstimmen (Mengengleichheit, wie der Starter sie prüft) – der Release-Job
// signiert damit nur, was zur Liste passt. Das Siegel nennt Version, base und arch (aus version.json), den SHA-512 der Liste und den Signaturschlüssel; ist das nicht der
// eingebaute Release-Schlüssel, steckt die Beglaubigung des Wurzelschlüssels (release-keys.json) im Siegel.
//
// Beglaubigungs-Ablauf: Der Starter prüft ihn nie (nur die App beim Installieren), darum sorgt dieses Skript dafür, dass kein Siegel mit einer Beglaubigung
// entsteht, die in weniger als 90 Tagen abläuft (Abbruch), und warnt unter 180 Tagen (die Update-Seite warnt ab 90 Tagen vor Ablauf).
// Nur für Tests: SOS_NOW=JJJJ-MM-TT ersetzt das heutige Datum, RELEASE_KEY_FILE die Schlüsseldatei.
import { createPublicKey } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { endOfDay, parseEndorsements, parseEndorsementStatement, pemToRawKey, samePublicKey, verifyEndorsement } from "../src/lib/updates/keychain.ts";
import { createSeal, sealFieldsFor, verifySeal } from "../src/lib/updates/seal.ts";
import { nodeFs, parseTree, TREE_FILE, verifyTreeAgainstFs } from "../src/lib/updates/tree.ts";
import { argOf, assertOwnRootKey, endorsementsFile, readTrustAnchors } from "./lib/trust.mjs";

const MIN_DAYS = 90;
const WARN_DAYS = 180;

const args = process.argv.slice(2);
const bundle = resolve(argOf(args, "--bundle"));
const out = resolve(argOf(args, "--out"));
const privateKey = process.env.RELEASE_SIGNING_KEY;
if (!privateKey) throw new Error("RELEASE_SIGNING_KEY ist nicht gesetzt.");
const now = process.env.SOS_NOW ? new Date(`${process.env.SOS_NOW}T00:00:00Z`) : new Date();

const meta = JSON.parse(readFileSync(resolve(bundle, "version.json"), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(meta.version)) throw new Error(`Nur Release-Versionen (x.y.z) können gesiegelt werden, nicht ${meta.version}.`);
if (!Number.isInteger(meta.base) || typeof meta.arch !== "string") throw new Error("version.json: base (Zahl) und arch fehlen.");

// 1) Verzeichnis ↔ Liste
if (!existsSync(resolve(bundle, TREE_FILE))) throw new Error(`${TREE_FILE} fehlt im Paket (scripts/gen-tree.mjs im Image-Bau?).`);
const treeBytes = readFileSync(resolve(bundle, TREE_FILE));
const entries = parseTree(treeBytes);
const failure = await verifyTreeAgainstFs(nodeFs(bundle), entries);
if (failure) throw new Error(`Das Paket weicht von ${TREE_FILE} ab (${failure.reason}: ${failure.path}) – es wird nicht gesiegelt.`);

// 2) Schlüssel
const anchors = readTrustAnchors();
assertOwnRootKey(anchors);
const signingPublic = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
let endorsement;
if (!samePublicKey(signingPublic, anchors.releasePem)) {
  const file = endorsementsFile();
  const offered = existsSync(file) ? parseEndorsements(JSON.parse(readFileSync(file, "utf8"))) : [];
  endorsement = offered.find((e) => {
    const key = verifyEndorsement(e, anchors.rootPem, now);
    return key && samePublicKey(key, signingPublic);
  });
  if (!endorsement) throw new Error("Der Signaturschlüssel ist nicht der eingebaute Release-Schlüssel und es gibt keine gültige Beglaubigung dafür (release-keys.json, noch nicht abgelaufen).");
  const until = parseEndorsementStatement(Buffer.from(endorsement.statement, "base64")).validUntil;
  const days = Math.floor((endOfDay(until) - now.getTime()) / 86_400_000);
  if (days < MIN_DAYS) throw new Error(`Die Beglaubigung des Signaturschlüssels läuft am ${until} ab (in ${days} Tagen) – kein Siegel mit weniger als ${MIN_DAYS} Tagen Restlaufzeit. Zuerst neu beglaubigen (scripts/endorse-release-key.mjs).`);
  if (days < WARN_DAYS) console.warn(`::warning::Die Beglaubigung des Signaturschlüssels läuft am ${until} ab (in ${days} Tagen) – bald neu beglaubigen.`);
}

// 3) Siegel erzeugen und gegen die eigenen Anker prüfen
const seal = createSeal(sealFieldsFor(treeBytes, meta), privateKey, { builtInKeyPem: anchors.releasePem, endorsement });
const check = verifySeal(seal, { releaseKey: pemToRawKey(anchors.releasePem), rootKey: pemToRawKey(anchors.rootPem) }, now);
if (!check.ok) throw new Error(`Das erzeugte Siegel besteht die eigene Prüfung nicht (${check.reason}).`);
writeFileSync(resolve(out, "SOS-SEAL"), seal);
console.log(`Siegel für ${meta.version} erzeugt (${entries.length} Einträge, ${check.seal.treeBytes} Bytes, ${endorsement ? "beglaubigter Schlüssel" : "eingebauter Release-Schlüssel"}).`);
