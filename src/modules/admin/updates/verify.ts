import "server-only";
import { existsSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { pemToRawKey } from "@/lib/updates/keychain";
import { findNodeModulesAncestor, verifyVersion, type VerifyFailure, type VerifySuccess } from "@/lib/updates/seal";
import { parseStarterVerdict, runStarter, starterArgs } from "@/lib/updates/starter-verify";
import { nodeFs } from "@/lib/updates/tree";
import { dataDir, readMeta } from "@/lib/updates/store";
import { runningMeta, updateConfig } from "./config";

/**
 * Prüfung einer entpackten Version vor ihrer Aktivierung (Starter-Vertrauensanker, README): derselbe Prüfumfang wie beim Start durch den Starter im Image –
 * Siegel (Signatur, Kette, Ablauf der Beglaubigung), Dateiliste, Mengengleichheit des Baums, Vorfahrenregel (`node_modules` oberhalb), Untergrenze, Starter-Vertrag.
 * Was hier besteht, besteht beim Start; was hier scheitert, wird nie aktiviert.
 *
 * Im Betrieb (Image) ruft der Installer den Prüfer des Starters auf – `/bootstrap --verify <Ordner> --expect-version <v> --check-expiry <heute>` –, damit für Installation und Start dieselbe
 * Implementierung gilt (docker/verify.c). Fehlt `/bootstrap` (Entwicklung, Tests), prüft der TypeScript-Referenzprüfer (`lib/updates/seal.ts`); der Vertrag beider ist in README „Starter-Vertrauensanker“
 * festgelegt, der Goldkorpus und die nativen Tests (docker/test) halten sie gleich. Die Prüfung ist außerdem **einspritzbar** (Tests).
 */
export type TreeVerifier = (input: { dir: string; version: string; now: Date }) => Promise<VerifySuccess | VerifyFailure>;

let injected: TreeVerifier | null = null;

/** Ersetzt die Prüfung (Tests; später der Aufruf von `/bootstrap --verify`). `null` stellt den Referenzprüfer wieder her. */
export function setTreeVerifier(verifier: TreeVerifier | null): void {
  injected = verifier;
}

/** Verzeichnis der im Image eingebauten Version: ihre Version ist die Untergrenze (eine installierte Version muss darüber liegen). */
export const builtinDir = () => process.env.BUILTIN_DIR ?? "/app";

const referenceVerifier: TreeVerifier = async ({ dir, version, now }) => {
  const { builtInKey, rootKey } = await updateConfig();
  const releaseKey = pemToRawKey(builtInKey);
  const root = pemToRawKey(rootKey);
  if (!releaseKey || !root) return { ok: false, code: 11, reason: "trust-anchor" };
  const running = runningMeta();
  const builtin = readMeta(builtinDir());
  const exists = (candidate: string) => lstat(candidate).then(() => true, () => false);
  return verifyVersion({
    fs: nodeFs(dir),
    trust: { releaseKey, rootKey: root },
    expectVersion: version,
    image: { base: running.base, arch: running.arch ?? process.arch },
    floor: builtin?.version,
    checkExpiry: now,
    ancestorProbe: () => findNodeModulesAncestor(dir, dataDir(), exists),
  });
};

/** Der Starter im Image (Entwicklung: nicht vorhanden); `BOOTSTRAP_BINARY` ist nur für Tests und Spiegel-Aufbauten gedacht, keine Betriebseinstellung. */
const starterBinary = () => process.env.BOOTSTRAP_BINARY ?? "/bootstrap";

const starterVerifier: TreeVerifier = async ({ dir, version, now }) => {
  const result = await runStarter(starterBinary(), starterArgs(dir, version, now), { PATH: process.env.PATH ?? "", DATA_DIR: dataDir(), NODE_ENV: "production" });
  return parseStarterVerdict(result.code, result.stdout);
};

export const verifyInstalledTree: TreeVerifier = (input) => (injected ?? (existsSync(starterBinary()) ? starterVerifier : referenceVerifier))(input);
