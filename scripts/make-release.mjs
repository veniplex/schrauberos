// Erzeugt manifest.json und manifest.json.sig für ein Release-Paket (aufgerufen von der Release-Pipeline).
//   RELEASE_SIGNING_KEY="<PEM>" node scripts/make-release.mjs --archive <paket.tar.gz> --bundle <entpacktes-verzeichnis> --out <ordner>
// Das Manifest nennt Version, Image-Unterbau (base), Dateiname, SHA-256 und Größe des Pakets.
// Die Signatur (Ed25519) wird zur Sicherheit gleich gegen die Schlüsselkette der App geprüft (eingebauter Release-Schlüssel oder ein
// vom Wurzelschlüssel beglaubigter aus release-keys.json) – so fällt ein falsches Secret in der Pipeline auf und nicht erst bei den
// Anwendern. Liegt release-keys.json im Repository, wird sie dem Release beigelegt (die App merkt sich die Beglaubigungen).
import { createHash, createPublicKey, sign, verify } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEndorsements, trustedReleaseKeys } from "../src/lib/updates/keychain.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) throw new Error(`Parameter ${name} fehlt.`);
  return args[i + 1];
};

const archive = resolve(arg("--archive"));
const bundle = resolve(arg("--bundle"));
const out = resolve(arg("--out"));
const privateKey = process.env.RELEASE_SIGNING_KEY;
if (!privateKey) throw new Error("RELEASE_SIGNING_KEY ist nicht gesetzt.");

const meta = JSON.parse(readFileSync(resolve(bundle, "version.json"), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(meta.version)) throw new Error(`Nur Release-Versionen (x.y.z) können veröffentlicht werden, nicht ${meta.version}.`);

const manifest = {
  schema: 1,
  version: meta.version,
  base: meta.base,
  arch: meta.arch ?? "x64",
  asset: basename(archive),
  sha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
  size: statSync(archive).size,
};
const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
const signature = sign(null, bytes, privateKey);

const source = readFileSync(resolve(root, "src/modules/admin/updates/release-key.ts"), "utf8");
const keyOf = (name) => new RegExp(`${name}\\s*=\\s*\`(-----BEGIN PUBLIC KEY-----[\\s\\S]*?-----END PUBLIC KEY-----\\n?)\``).exec(source)?.[1];
const publicPem = keyOf("RELEASE_PUBLIC_KEY");
if (!publicPem) throw new Error("Öffentlicher Schlüssel in release-key.ts nicht gefunden.");
// Steht ROOT_PUBLIC_KEY noch als Zuweisung `= RELEASE_PUBLIC_KEY` da, gilt der Release-Schlüssel zugleich als Wurzel
const rootPem = keyOf("ROOT_PUBLIC_KEY") ?? publicPem;
const keysFile = resolve(root, "release-keys.json");
const endorsements = existsSync(keysFile) ? parseEndorsements(JSON.parse(readFileSync(keysFile, "utf8"))) : [];
const trusted = trustedReleaseKeys({ root: rootPem, builtIn: [publicPem], endorsements });
if (!trusted.some((pem) => verify(null, bytes, createPublicKey(pem), signature))) {
  throw new Error("Die Signatur passt weder zum eingebauten Release-Schlüssel noch zu einem beglaubigten – falsches RELEASE_SIGNING_KEY oder fehlende Beglaubigung (release-keys.json)?");
}
if (endorsements.length) copyFileSync(keysFile, resolve(out, "release-keys.json"));

writeFileSync(resolve(out, "manifest.json"), bytes);
writeFileSync(resolve(out, "manifest.json.sig"), signature);
console.log(`Manifest für ${manifest.version} erzeugt und signiert (${manifest.size} Bytes, sha256 ${manifest.sha256.slice(0, 12)}…).`);
