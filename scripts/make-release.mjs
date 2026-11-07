// Erzeugt manifest.json und manifest.json.sig für ein Release-Paket (aufgerufen von der Release-Pipeline).
//   RELEASE_SIGNING_KEY="<PEM>" node scripts/make-release.mjs --archive <paket.tar.gz> --bundle <entpacktes-verzeichnis> --out <ordner>
// Das Manifest nennt Version, Image-Unterbau (base), Dateiname, SHA-256 und Größe des Pakets.
// Die Signatur (Ed25519) wird zur Sicherheit gleich gegen die Schlüsselkette der App geprüft (eingebauter Release-Schlüssel oder ein
// vom Wurzelschlüssel beglaubigter aus release-keys.json) – so fällt ein falsches Secret in der Pipeline auf und nicht erst bei den
// Anwendern. Liegt release-keys.json im Repository, wird sie dem Release beigelegt (die App merkt sich die Beglaubigungen).
import { createHash, createPublicKey, sign, verify } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { manifestSignedBytes, parseEndorsements, trustedReleaseKeys } from "../src/lib/updates/keychain.ts";
import { assertOwnRootKey, endorsementsFile, readTrustAnchorsChecked } from "./lib/trust.mjs";

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
// Signiert wird Kontext ("schrauberos-manifest-v1" + Zeilenumbruch) + Manifest: eine Manifest-Signatur ist nie mit einer Beglaubigung oder einem Siegel verwechselbar
const signed = manifestSignedBytes(bytes);
const signature = sign(null, signed, privateKey);

// Kein stilles Zurückfallen: Ist ROOT_PUBLIC_KEY noch eine Zuweisung `= RELEASE_PUBLIC_KEY` (oder dasselbe PEM), schützt die Kette nicht –
// wer das GitHub-Secret hat, könnte zugleich beglaubigen. Der Tag-Build bricht dann ab, bis ein eigener Offline-Wurzelschlüssel eingetragen ist.
const anchors = await readTrustAnchorsChecked();
assertOwnRootKey(anchors);
const { releasePem: publicPem, rootPem } = anchors;
const keysFile = endorsementsFile();
const endorsements = existsSync(keysFile) ? parseEndorsements(JSON.parse(readFileSync(keysFile, "utf8"))) : [];
const trusted = trustedReleaseKeys({ root: rootPem, builtIn: [publicPem], endorsements });
if (!trusted.some((pem) => verify(null, signed, createPublicKey(pem), signature))) {
  throw new Error("Die Signatur passt weder zum eingebauten Release-Schlüssel noch zu einem beglaubigten – falsches RELEASE_SIGNING_KEY oder fehlende Beglaubigung (release-keys.json)?");
}
if (endorsements.length) copyFileSync(keysFile, resolve(out, "release-keys.json"));

writeFileSync(resolve(out, "manifest.json"), bytes);
writeFileSync(resolve(out, "manifest.json.sig"), signature);
console.log(`Manifest für ${manifest.version} erzeugt und signiert (${manifest.size} Bytes, sha256 ${manifest.sha256.slice(0, 12)}…).`);
