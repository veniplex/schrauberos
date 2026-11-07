// Prüft, dass das Secret RELEASE_SIGNING_KEY zum öffentlichen Schlüssel im Code passt (oder zu einem beglaubigten): Es signiert eine Zufallsnachricht und prüft sie gegen
// die Schlüsselkette von src/modules/admin/updates/release-key.ts. Veröffentlicht nichts und gibt keinen Schlüsselinhalt aus (nur Fingerabdrücke).
// Läuft im Workflow nur in der Umgebung "release" (Freigabe des Pflicht-Reviewers) – nie als „Generalprobe“, die jeder Zweig auslösen könnte.
import { createHash, createPublicKey, randomBytes, sign, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseEndorsements, pemToRawKey, trustedReleaseKeys } from "../src/lib/updates/keychain.ts";
import { assertOwnRootKey, endorsementsFile, readTrustAnchorsChecked } from "./lib/trust.mjs";

const privateKey = process.env.RELEASE_SIGNING_KEY;
if (!privateKey) throw new Error("RELEASE_SIGNING_KEY ist nicht gesetzt.");
const anchors = await readTrustAnchorsChecked();
assertOwnRootKey(anchors);
const file = endorsementsFile();
const endorsements = existsSync(file) ? parseEndorsements(JSON.parse(readFileSync(file, "utf8"))) : [];
const trusted = trustedReleaseKeys({ root: anchors.rootPem, builtIn: [anchors.releasePem], endorsements });
const message = randomBytes(32);
const signature = sign(null, message, privateKey);
const match = trusted.find((pem) => verify(null, message, createPublicKey(pem), signature));
if (!match) throw new Error("Das Secret RELEASE_SIGNING_KEY passt weder zum eingebauten Release-Schlüssel noch zu einem beglaubigten Schlüssel (release-keys.json).");
const fingerprint = createHash("sha256").update(pemToRawKey(match)).digest("hex").slice(0, 16);
console.log(`Das Secret passt zum ${match === anchors.releasePem ? "eingebauten Release-Schlüssel" : "beglaubigten Schlüssel"} (Fingerabdruck ${fingerprint}).`);
