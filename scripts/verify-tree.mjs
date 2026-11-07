// Prüft ein Paketverzeichnis mit dem TypeScript-Referenzprüfer (derselbe Vertrag wie `/bootstrap --verify`, siehe README „Starter-Vertrauensanker“):
//   node scripts/verify-tree.mjs <verzeichnis>
//       Dateiliste SOS-TREE ↔ Verzeichnis (Mengengleichheit), ohne Siegel. Zusätzlich: nichts ist für Gruppe oder Andere schreibbar, kein Setuid/Setgid/Sticky
//       (Smoke-Test des Images: die eingebaute App ist root-eigen und nicht schreibbar).
//   node scripts/verify-tree.mjs <verzeichnis> --seal <SOS-SEAL> --expect-version 0.2.0 [--no-floor | --floor <Version>] [--check-expiry JJJJ-MM-TT]
//       vollständig: Siegel (mit den Schlüsseln aus release-key.ts), Liste, Baum. Das Siegel darf außerhalb des Verzeichnisses liegen (Release-Asset).
// Ausgabe: eine JSON-Zeile; Exit-Code wie der Prüfer des Starters (0 = ok, 10–19 siehe README).
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pemToRawKey } from "../src/lib/updates/keychain.ts";
import { verifyVersion } from "../src/lib/updates/seal.ts";
import { nodeFs, parseTree, TREE_FILE, treeStats, verifyTreeAgainstFs } from "../src/lib/updates/tree.ts";
import { argOf, readTrustAnchorsChecked } from "./lib/trust.mjs";

const args = process.argv.slice(2);
if (!args[0]) throw new Error("Aufruf: node scripts/verify-tree.mjs <verzeichnis> [--seal DATEI --expect-version V ...]");
const dir = resolve(args[0]);
const sealFile = argOf(args, "--seal", false);
const started = Date.now();

const print = (value, code) => {
  console.log(JSON.stringify({ ...value, ms: Date.now() - started }));
  process.exit(code);
};

if (sealFile) {
  const anchors = await readTrustAnchorsChecked();
  const base = nodeFs(dir);
  const external = nodeFs(dirname(resolve(sealFile)));
  const sealName = basename(sealFile);
  // Das Siegel kommt aus der angegebenen Datei, der Baum bleibt unberührt
  const fs = {
    ...base,
    lstat: (rel) => (rel === "SOS-SEAL" ? external.lstat(sealName) : base.lstat(rel)),
    readFile: (rel, max) => (rel === "SOS-SEAL" ? external.readFile(sealName, max) : base.readFile(rel, max)),
  };
  const expiry = argOf(args, "--check-expiry", false);
  const result = await verifyVersion({
    fs,
    trust: { releaseKey: pemToRawKey(anchors.releasePem), rootKey: pemToRawKey(anchors.rootPem ?? anchors.releasePem) },
    expectVersion: argOf(args, "--expect-version"),
    floor: args.includes("--no-floor") ? undefined : argOf(args, "--floor", false),
    checkExpiry: expiry ? new Date(`${expiry}T12:00:00Z`) : null,
  });
  print(result, result.ok ? 0 : result.code);
}

if (!existsSync(join(dir, TREE_FILE))) print({ ok: false, code: 13, reason: "tree-missing" }, 13);
const entries = parseTree(readFileSync(join(dir, TREE_FILE)));
const failure = await verifyTreeAgainstFs(nodeFs(dir), entries);
if (failure) print({ ok: false, code: failure.code, reason: failure.reason, path: failure.path }, failure.code);

const walk = (current, rel) => {
  for (const name of readdirSync(current)) {
    const full = join(current, name);
    const st = lstatSync(full);
    const path = rel ? `${rel}/${name}` : name;
    if (!st.isSymbolicLink() && st.mode & 0o7022) print({ ok: false, code: 16, reason: "mode", path, mode: (st.mode & 0o7777).toString(8) }, 16);
    if (st.isDirectory()) walk(full, path);
  }
};
if (process.platform !== "win32") walk(dir, "");
const stats = treeStats(entries);
print({ ok: true, files: stats.entries, bytes: stats.bytes }, 0);
