// Beglaubigt einen (neuen) Release-Schlüssel mit dem Wurzelschlüssel – OFFLINE ausführen, der private Wurzelschlüssel gehört nie
// ins Repository, in ein GitHub-Secret oder auf den Server.
//   ROOT_SIGNING_KEY_FILE=wurzel-privat.pem node scripts/endorse-release-key.mjs --public release-public-key.pem --valid-until 2031-12-31
// Das Ergebnis wird in `release-keys.json` (Repository-Wurzel) eingetragen und committet; die Release-Pipeline legt die Datei dem
// Release bei, die App prüft die Kette Wurzel → Release-Schlüssel und merkt sich die Beglaubigung, und `make-seal.mjs` bettet sie in das Siegel jeder
// Version ein (Format 2, siehe src/lib/updates/keychain.ts). Mehrere Aufrufe hängen an.
// --valid-until ist Pflicht und höchstens 5 Jahre in der Zukunft: Der Starter im Image prüft den Ablauf nie, die App aber schon; ein sehr fernes Datum machte
// einen einmal beglaubigten Schlüssel praktisch unbefristet.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createEndorsement, isCalendarDate, parseEndorsements, verifyEndorsement } from "../src/lib/updates/keychain.ts";
import { argOf, readTrustAnchors, repoRoot } from "./lib/trust.mjs";

const args = process.argv.slice(2);
const keyFile = process.env.ROOT_SIGNING_KEY_FILE;
if (!keyFile) throw new Error("ROOT_SIGNING_KEY_FILE (Pfad zur privaten Wurzelschlüssel-Datei) ist nicht gesetzt.");
const rootPrivate = readFileSync(keyFile, "utf8");
const releasePublic = readFileSync(resolve(argOf(args, "--public")), "utf8");
// Pflicht: Eine unbefristete Beglaubigung gilt nicht (die App lehnt sie ab)
const validUntil = argOf(args, "--valid-until");
if (!isCalendarDate(validUntil)) throw new Error("--valid-until: Format JJJJ-MM-TT (echtes Datum).");
const limit = new Date();
limit.setUTCFullYear(limit.getUTCFullYear() + 5);
if (Date.parse(`${validUntil}T23:59:59Z`) > limit.getTime()) throw new Error("--valid-until liegt mehr als 5 Jahre in der Zukunft.");

const { rootPem } = readTrustAnchors();
if (!rootPem) throw new Error("ROOT_PUBLIC_KEY in release-key.ts ist kein eigener Schlüssel (noch gleich dem Release-Schlüssel): zuerst den Wurzelschlüssel eintragen.");

const file = resolve(repoRoot, "release-keys.json");
const existing = existsSync(file) ? parseEndorsements(JSON.parse(readFileSync(file, "utf8"))) : [];
const added = createEndorsement(rootPrivate, releasePublic, validUntil);
if (verifyEndorsement(added, rootPem) === null) throw new Error("Die Beglaubigung passt nicht zum ROOT_PUBLIC_KEY in release-key.ts – falscher privater Wurzelschlüssel?");
writeFileSync(file, JSON.stringify({ keys: [...existing, added] }, null, 2) + "\n");
console.log(`Release-Schlüssel beglaubigt bis ${validUntil} (${existing.length + 1} Einträge in release-keys.json).`);
