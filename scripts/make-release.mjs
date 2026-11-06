// Erzeugt manifest.json und manifest.json.sig für ein Release-Paket (aufgerufen von der Release-Pipeline).
//   RELEASE_SIGNING_KEY="<PEM>" node scripts/make-release.mjs --archive <paket.tar.gz> --bundle <entpacktes-verzeichnis> --out <ordner>
// Das Manifest nennt Version, Image-Unterbau (base), Dateiname, SHA-256 und Größe des Pakets.
// Die Signatur (Ed25519) wird zur Sicherheit gleich gegen den in der App eingebauten öffentlichen Schlüssel geprüft –
// so fällt ein falsches Secret in der Pipeline auf und nicht erst bei den Anwendern.
import { createHash, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const publicPem = /`(-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----\n?)`/.exec(source)?.[1];
if (!publicPem) throw new Error("Öffentlicher Schlüssel in release-key.ts nicht gefunden.");
if (!verify(null, bytes, createPublicKey(publicPem), signature)) throw new Error("Die Signatur passt nicht zum eingebauten öffentlichen Schlüssel – falsches RELEASE_SIGNING_KEY?");

writeFileSync(resolve(out, "manifest.json"), bytes);
writeFileSync(resolve(out, "manifest.json.sig"), signature);
console.log(`Manifest für ${manifest.version} erzeugt und signiert (${manifest.size} Bytes, sha256 ${manifest.sha256.slice(0, 12)}…).`);
