// Beglaubigt einen (neuen) Release-Schlüssel mit dem Wurzelschlüssel – OFFLINE ausführen, der private Wurzelschlüssel gehört nie
// ins Repository, in ein GitHub-Secret oder auf den Server.
//   ROOT_SIGNING_KEY_FILE=wurzel-privat.pem node scripts/endorse-release-key.mjs --public release-public-key.pem --valid-until 2031-12-31
// Das Ergebnis wird in `release-keys.json` (Repository-Wurzel) eingetragen und committet; die Release-Pipeline legt die Datei dem
// Release bei, die App prüft die Kette Wurzel → Release-Schlüssel und merkt sich die Beglaubigung. Mehrere Aufrufe hängen an.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEndorsement, parseEndorsements, verifyEndorsement } from "../src/lib/updates/keychain.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name, required = true) => {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) {
    if (required) throw new Error(`Parameter ${name} fehlt.`);
    return undefined;
  }
  return args[i + 1];
};

const keyFile = process.env.ROOT_SIGNING_KEY_FILE;
if (!keyFile) throw new Error("ROOT_SIGNING_KEY_FILE (Pfad zur privaten Wurzelschlüssel-Datei) ist nicht gesetzt.");
const rootPrivate = readFileSync(keyFile, "utf8");
const releasePublic = readFileSync(resolve(arg("--public")), "utf8");
// Pflicht: Eine unbefristete Beglaubigung gilt nicht (die App lehnt sie ab)
const validUntil = arg("--valid-until");
if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || Number.isNaN(Date.parse(`${validUntil}T23:59:59Z`))) throw new Error("--valid-until: Format JJJJ-MM-TT.");

const source = readFileSync(resolve(root, "src/modules/admin/updates/release-key.ts"), "utf8");
const rootPublic = /ROOT_PUBLIC_KEY\s*=\s*`(-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----\n?)`/.exec(source)?.[1];
if (!rootPublic) throw new Error("ROOT_PUBLIC_KEY in release-key.ts ist kein eigener Schlüssel (noch gleich dem Release-Schlüssel): zuerst den Wurzelschlüssel eintragen.");

const file = resolve(root, "release-keys.json");
const existing = existsSync(file) ? parseEndorsements(JSON.parse(readFileSync(file, "utf8"))) : [];
const added = createEndorsement(rootPrivate, releasePublic, validUntil);
if (verifyEndorsement(added, rootPublic) === null) throw new Error("Die Beglaubigung passt nicht zum ROOT_PUBLIC_KEY in release-key.ts – falscher privater Wurzelschlüssel?");
writeFileSync(file, JSON.stringify({ keys: [...existing, added] }, null, 2) + "\n");
console.log(`Release-Schlüssel beglaubigt (${existing.length + 1} Einträge in release-keys.json).`);
