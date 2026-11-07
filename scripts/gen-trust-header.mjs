// Erzeugt den C-Header mit den Vertrauensankern des Starters aus src/modules/admin/updates/release-key.ts (die einzige Quelle der Schlüssel – App und Starter
// können nicht auseinanderlaufen):
//   node scripts/gen-trust-header.mjs [--out docker/trust-keys.h] [--version <eingebaute Version>] [--arch x64] [--tag-build] [--release-key-file <datei>]
//   node scripts/gen-trust-header.mjs --print-fingerprints        gibt nur die erwarteten Fingerabdrücke aus ("root <16 Hex>" / "release <16 Hex>"), schreibt nichts (Echtprobe)
//   node scripts/gen-trust-header.mjs --print-test-fingerprints   dasselbe für die Testschlüssel (Negativprobe: das Produktions-Image darf sie nicht tragen)
// Der Header ist ein Bau-Artefakt (nicht eingecheckt, .gitignore). Inhalt: Wurzel- und Release-Schlüssel roh (32 Bytes), die Untergrenze als Tripel + Vorabflag
// (aus der eingebauten Version; der Vergleich in C ist nur `exceedsFloor` in Zahlen, die einzige SemVer-Logik bleibt `src/lib/updates/semver.ts`), `SOS_BASE`
// (docker/BASE_VERSION) und die Architektur.
//
// **Wurzelgate:** Bei Tag-Builds (`--tag-build` oder SOS_TAG_BUILD=1, im Dockerfile aus dem Build-Arg) bricht dieses Skript ab, wenn ROOT_PUBLIC_KEY fehlt oder gleich
// RELEASE_PUBLIC_KEY ist oder einer der Testschlüssel (src/lib/updates/testdata/anchor/test-keys.ts) im Image landen würde. Die Wurzel steht im Image, das vor dem
// Release-Job gebaut wird – ein falscher Anker ließe sich in einem veröffentlichten Image nicht mehr ändern. Ohne Tag-Build (edge, lokal) fällt die Wurzel mit einer
// Warnung auf den Release-Schlüssel zurück.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pemToRawKey, rootKeyProblem } from "../src/lib/updates/keychain.ts";
import { floorOf } from "../src/lib/updates/semver.ts";
import { TEST_RELEASE, TEST_ROGUE, TEST_ROOT, TEST_OTHER_ROOT, TEST_SECOND } from "../src/lib/updates/testdata/anchor/test-keys.ts";
import { argOf, readTrustAnchorsChecked, repoRoot } from "./lib/trust.mjs";

const args = process.argv.slice(2);
const fingerprint = (buffer) => createHash("sha256").update(buffer).digest("hex").slice(0, 16);
if (args.includes("--print-test-fingerprints")) {
  for (const key of [TEST_ROOT, TEST_RELEASE, TEST_SECOND, TEST_ROGUE, TEST_OTHER_ROOT]) console.log(`test ${fingerprint(Buffer.from(key.publicHex, "hex"))}`);
  process.exit(0);
}
const out = resolve(argOf(args, "--out", false) ?? resolve(repoRoot, "docker/trust-keys.h"));
const tagBuild = args.includes("--tag-build") || process.env.SOS_TAG_BUILD === "1";
const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const version = argOf(args, "--version", false) ?? process.env.APP_VERSION ?? `${pkg.version}-dev`;
const arch = argOf(args, "--arch", false) ?? process.env.SOS_ARCH ?? process.arch;
const floor = floorOf(version);
if (!floor) throw new Error(`Ungültige eingebaute Version: ${version}`);
if (!/^[a-z0-9_]{1,16}$/.test(arch)) throw new Error(`Ungültige Architektur: ${arch}`);
const base = Number(readFileSync(resolve(repoRoot, "docker/BASE_VERSION"), "utf8").trim());
if (!Number.isInteger(base) || base < 1) throw new Error("docker/BASE_VERSION muss eine ganze Zahl >= 1 enthalten.");

const anchors = await readTrustAnchorsChecked(argOf(args, "--release-key-file", false));
const problem = rootKeyProblem(anchors.releasePem, anchors.rootPem);
if (problem && tagBuild) {
  throw new Error(
    `Tag-Build abgebrochen: ${problem === "root-missing" ? "ROOT_PUBLIC_KEY ist kein eigener Schlüssel (noch die Zuweisung an RELEASE_PUBLIC_KEY)" : "ROOT_PUBLIC_KEY ist derselbe Schlüssel wie RELEASE_PUBLIC_KEY"}. ` +
      "Der Wurzelschlüssel steht im Image und lässt sich danach nicht mehr ändern: zuerst einen eigenen Offline-Wurzelschlüssel erzeugen und eintragen (README, „Schlüsselkette“).",
  );
}
if (problem) console.warn("Warnung: ROOT_PUBLIC_KEY ist kein eigener Schlüssel – der Starter vertraut nur dem Release-Schlüssel (nur für Entwicklung/edge, nie für ein Tag-Image).");
const release = pemToRawKey(anchors.releasePem);
const root = pemToRawKey(anchors.rootPem ?? anchors.releasePem);
if (!release || !root) throw new Error("Release- oder Wurzelschlüssel ist kein Ed25519-Schlüssel.");

if (tagBuild) {
  for (const key of [TEST_ROOT, TEST_RELEASE, TEST_SECOND, TEST_ROGUE, TEST_OTHER_ROOT]) {
    if (release.toString("hex") === key.publicHex || root.toString("hex") === key.publicHex) throw new Error("Tag-Build abgebrochen: Ein Testschlüssel (testdata/anchor/test-keys.ts) wäre Vertrauensanker des Images.");
  }
}

const bytes = (buffer) => {
  const rows = [];
  for (let i = 0; i < buffer.length; i += 8) rows.push("  " + [...buffer.subarray(i, i + 8)].map((b) => "0x" + b.toString(16).padStart(2, "0")).join(", "));
  return rows.join(",\n");
};

if (args.includes("--print-fingerprints")) {
  console.log(`root ${fingerprint(root)}
release ${fingerprint(release)}`);
  process.exit(0);
}

writeFileSync(
  out,
  `/* GENERIERT von scripts/gen-trust-header.mjs aus src/modules/admin/updates/release-key.ts – nicht bearbeiten, nicht einchecken. */
#ifndef SOS_TRUST_KEYS_H
#define SOS_TRUST_KEYS_H

#define SOS_BASE ${base}
#define SOS_ARCH "${arch}"
/* Untergrenze = eingebaute Version ${version}; eine installierte Version muss strikt größer sein (exceedsFloor in semver.ts) */
#define SOS_BUILTIN_VERSION "${version}"
#define SOS_FLOOR_MAJOR ${floor.major}
#define SOS_FLOOR_MINOR ${floor.minor}
#define SOS_FLOOR_PATCH ${floor.patch}
#define SOS_FLOOR_PRERELEASE ${floor.prerelease ? 1 : 0}
#define SOS_TAG_BUILD ${tagBuild ? 1 : 0}

/* Fingerabdrücke (erste 16 Hexziffern von SHA-256 über den rohen Schlüssel), für --print-keys */
#define SOS_ROOT_FINGERPRINT "${fingerprint(root)}"
#define SOS_RELEASE_FINGERPRINT "${fingerprint(release)}"

static const unsigned char SOS_ROOT_KEY[32] = {
${bytes(root)}
};
static const unsigned char SOS_RELEASE_KEY[32] = {
${bytes(release)}
};

#endif
`,
);
console.log(`Vertrauensanker geschrieben: ${out} (Untergrenze ${version}, base ${base}, ${arch}, Wurzel ${fingerprint(root)}, Release ${fingerprint(release)}${tagBuild ? ", Tag-Build" : ""}).`);
