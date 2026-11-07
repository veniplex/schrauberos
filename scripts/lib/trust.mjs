// Gemeinsame Hilfen der Release-Skripte (make-release, make-seal, gen-trust-header, endorse-release-key): liest die Vertrauensanker aus
// src/modules/admin/updates/release-key.ts – die **einzige** Quelle der Schlüssel (App und Starter).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rootKeyProblem } from "../../src/lib/updates/keychain.ts";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const keyOf = (source, name) => new RegExp(`${name}\\s*=\\s*\`(-----BEGIN PUBLIC KEY-----[\\s\\S]*?-----END PUBLIC KEY-----\\n?)\``).exec(source)?.[1];

/**
 * Release- und Wurzelschlüssel (PEM) aus release-key.ts. `RELEASE_KEY_FILE`: nur für Tests (Pfad zu einer Kopie). `rootPem` ist `undefined`, solange
 * ROOT_PUBLIC_KEY noch die Zuweisung `= RELEASE_PUBLIC_KEY` ist.
 */
export function readTrustAnchors(file = process.env.RELEASE_KEY_FILE ?? resolve(repoRoot, "src/modules/admin/updates/release-key.ts")) {
  const source = readFileSync(file, "utf8");
  const releasePem = keyOf(source, "RELEASE_PUBLIC_KEY");
  if (!releasePem) throw new Error("Öffentlicher Schlüssel in release-key.ts nicht gefunden.");
  return { releasePem, rootPem: keyOf(source, "ROOT_PUBLIC_KEY") };
}

/** Datei mit den Beglaubigungen (`release-keys.json` im Repository; `RELEASE_KEYS_FILE` nur für Tests). */
export const endorsementsFile = () => process.env.RELEASE_KEYS_FILE ?? resolve(repoRoot, "release-keys.json");

/** Bricht ab, solange der Wurzelschlüssel fehlt oder derselbe wie der Release-Schlüssel ist (kein stilles Zurückfallen). */
export function assertOwnRootKey({ releasePem, rootPem }) {
  const problem = rootKeyProblem(releasePem, rootPem);
  if (!problem) return;
  throw new Error(
    (problem === "root-missing"
      ? "ROOT_PUBLIC_KEY in release-key.ts ist kein eigener Schlüssel (steht noch als Zuweisung an RELEASE_PUBLIC_KEY)."
      : "ROOT_PUBLIC_KEY ist derselbe Schlüssel wie RELEASE_PUBLIC_KEY.") +
      " Abgebrochen: zuerst einen eigenen Wurzelschlüssel offline erzeugen und seinen öffentlichen Teil als ROOT_PUBLIC_KEY eintragen (README, „Schlüsselkette“).",
  );
}

/** Kommandozeilenargument `--name wert`. */
export function argOf(args, name, required = true) {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) {
    if (required) throw new Error(`Parameter ${name} fehlt.`);
    return undefined;
  }
  return args[i + 1];
}
