/**
 * `SOS-SEAL`: das vom Release-Schlüssel signierte Siegel einer App-Version, und die vollständige Prüfung einer installierten Version (Referenzprüfer in
 * TypeScript; der Starter im Image prüft mit C nach derselben Spezifikation, siehe README „Starter-Vertrauensanker“). Nur löschbare TypeScript-Syntax,
 * relative Importe mit `.ts` (Skripte importieren dieses Modul direkt).
 *
 * **Format** (UTF-8, nur `\n`, nur Kleinbuchstaben-Hex, keine Leerzeichen am Zeilenende, ≤ 8 KiB):
 *
 *     schrauberos-seal 1\n
 *     version <x.y.z>\n  base <n>\n  arch <a>\n  tree-sha512 <128 Hex>\n  tree-size <n>\n  tree-entries <n>\n  tree-bytes <n>\n      ← Rumpf
 *     signing-key <64 Hex: roher Ed25519-Schlüssel>\n                                                                                       ← Schwanz, Form A
 *     signature <128 Hex>\n
 *
 * oder, wenn der Signaturschlüssel nicht der eingebaute Release-Schlüssel ist (vom Wurzelschlüssel beglaubigt), der Schwanz in Form B:
 *
 *     signing-key <64 Hex>\n  endorsement <236 Hex: die 118 Bytes der Beglaubigungs-Aussage>\n  endorsement-sig <128 Hex>\n  signature <128 Hex>\n
 *
 * Der Schwanz hat **feste Länge** (A: 216 Bytes, B: 610), der Rumpf davor nicht. **Erst prüfen, dann lesen** (authenticate-then-parse): Die Echtheit wird allein
 * aus dem Schwanz und den Bytes davor festgestellt; der Rumpf wird erst gelesen, wenn die Signatur über `SEAL_CONTEXT + alles vor der signature-Zeile` stimmt.
 * Die Beglaubigung wird nicht „geparst“, sondern aus `signing-key` und ihrem Ablaufdatum nachgebaut (`keychain.ts`).
 */
import { createPublicKey, sign, verify } from "node:crypto";
import { ENDORSEMENT_STATEMENT_BYTES, endorsementStatement, pemToRawKey, rawKeyToObject, verifyEndorsementBytes, type Endorsement } from "./keychain.ts";
import { compareVersions, exceedsFloor, floorOf } from "./semver.ts";
import { parseTree, sha512Hex, treeStats, TREE_FILE, TREE_LIMITS, SEAL_FILE, verifyTreeAgainstFs, TreeError, type FsLike, type TreeFailure } from "./tree.ts";

export const SEAL_CONTEXT = "schrauberos-seal-v1\n";
export const SEAL_HEADER = "schrauberos-seal 1\n";
export const SEAL_MAX_BYTES = 8192;

const KEY_LINE = 12 + 64 + 1; // "signing-key " + 64 + "\n"
const ENDORSEMENT_LINE = 12 + ENDORSEMENT_STATEMENT_BYTES * 2 + 1; // "endorsement " + 236 + "\n"
const ENDORSEMENT_SIG_LINE = 16 + 128 + 1; // "endorsement-sig " + 128 + "\n"
const SIGNATURE_LINE = 10 + 128 + 1; // "signature " + 128 + "\n"
export const SEAL_TAIL_A = KEY_LINE + SIGNATURE_LINE; // 216
export const SEAL_TAIL_B = KEY_LINE + ENDORSEMENT_LINE + ENDORSEMENT_SIG_LINE + SIGNATURE_LINE; // 610

export type SealFields = {
  version: string;
  base: number;
  arch: string;
  /** SHA-512 der Datei SOS-TREE (Hex) */
  treeSha512: string;
  treeSize: number;
  treeEntries: number;
  treeBytes: number;
};

export type Seal = SealFields & {
  /** roher Signaturschlüssel (Hex) */
  signingKey: string;
  /** Datum der Beglaubigung, wenn der Schlüssel beglaubigt war (Form B) */
  endorsedUntil?: string;
};

// ───────── Erzeugen ─────────

const VERSION_PATTERN = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const ARCH_PATTERN = /^[a-z0-9_]{1,16}$/;
const NUMBER_PATTERN = /^(0|[1-9][0-9]{0,14})$/;

function bodyOf(f: SealFields): string {
  return (
    `${SEAL_HEADER}version ${f.version}\nbase ${f.base}\narch ${f.arch}\ntree-sha512 ${f.treeSha512}\n` +
    `tree-size ${f.treeSize}\ntree-entries ${f.treeEntries}\ntree-bytes ${f.treeBytes}\n`
  );
}

/** Die Felder des Siegels für eine Liste (Bytes der Datei SOS-TREE) und die Angaben aus version.json. */
export function sealFieldsFor(treeBuffer: Buffer, meta: { version: string; base: number; arch: string }): SealFields {
  const stats = treeStats(parseTree(treeBuffer));
  return { version: meta.version, base: meta.base, arch: meta.arch, treeSha512: sha512Hex(treeBuffer), treeSize: treeBuffer.length, treeEntries: stats.entries, treeBytes: stats.bytes };
}

/**
 * Baut und signiert ein Siegel. `endorsement` ist nötig, wenn der Signaturschlüssel nicht `releaseKeyPem` (der eingebaute Release-Schlüssel) ist: Dann steckt die
 * Beglaubigung im Siegel (Form B). Prüft die Felder streng (`verifySeal` würde sie ablehnen).
 */
export function createSeal(fields: SealFields, signingPrivatePem: string, options: { builtInKeyPem: string; endorsement?: Endorsement }): Buffer {
  if (!VERSION_PATTERN.test(fields.version)) throw new Error(`Siegel: ungültige Version ${fields.version}`);
  if (!Number.isInteger(fields.base) || fields.base < 1 || fields.base > 999_999) throw new Error("Siegel: ungültige base");
  if (!ARCH_PATTERN.test(fields.arch)) throw new Error("Siegel: ungültige arch");
  if (!/^[0-9a-f]{128}$/.test(fields.treeSha512)) throw new Error("Siegel: ungültiger tree-sha512");
  for (const [name, value] of [["tree-size", fields.treeSize], ["tree-entries", fields.treeEntries], ["tree-bytes", fields.treeBytes]] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || !NUMBER_PATTERN.test(String(value))) throw new Error(`Siegel: ungültiger Wert ${name}`);
  }
  const signingPublic = createPublicKey(signingPrivatePem).export({ type: "spki", format: "pem" }).toString();
  const signingRaw = pemToRawKey(signingPublic);
  const builtInRaw = pemToRawKey(options.builtInKeyPem);
  if (!signingRaw || !builtInRaw) throw new Error("Siegel: kein Ed25519-Schlüssel");
  const isBuiltIn = signingRaw.equals(builtInRaw);

  let tail = `signing-key ${signingRaw.toString("hex")}\n`;
  if (!isBuiltIn) {
    if (!options.endorsement) throw new Error("Siegel: Der Signaturschlüssel ist nicht der eingebaute Release-Schlüssel und es gibt keine Beglaubigung.");
    const statement = Buffer.from(options.endorsement.statement, "base64");
    const signature = Buffer.from(options.endorsement.signature, "base64");
    if (statement.length !== ENDORSEMENT_STATEMENT_BYTES || signature.length !== 64) throw new Error("Siegel: Beglaubigung hat nicht die feste Länge.");
    if (!statement.equals(endorsementStatement(signingRaw.toString("hex"), statement.toString("latin1").slice(-11, -1)))) throw new Error("Siegel: Die Beglaubigung gehört zu einem anderen Schlüssel.");
    tail += `endorsement ${statement.toString("hex")}\nendorsement-sig ${signature.toString("hex")}\n`;
  } else if (options.endorsement) throw new Error("Siegel: Der Signaturschlüssel ist der eingebaute Release-Schlüssel – keine Beglaubigung beilegen.");
  const signed = Buffer.from(bodyOf(fields) + tail, "utf8");
  const signature = sign(null, Buffer.concat([Buffer.from(SEAL_CONTEXT), signed]), signingPrivatePem);
  return Buffer.concat([signed, Buffer.from(`signature ${signature.toString("hex")}\n`)]);
}

// ───────── Prüfen ─────────

export type SealFailure = { ok: false; code: 10 | 11; reason: string };

const HEX = (n: number) => new RegExp(`^[0-9a-f]{${n}}$`);

/**
 * Prüft ein Siegel. `releaseKey`/`rootKey`: die rohen Schlüssel des Images. `now`: Ablauf der Beglaubigung prüfen (`null` = nicht prüfen – so liest der Starter).
 * Code 10: Format, Code 11: Signatur/Kette.
 */
export function verifySeal(buffer: Buffer, trust: { releaseKey: Buffer; rootKey: Buffer }, now: Date | null): { ok: true; seal: Seal } | SealFailure {
  const bad = (code: 10 | 11, reason: string): SealFailure => ({ ok: false, code, reason });
  if (buffer.length > SEAL_MAX_BYTES) return bad(10, "too-large");
  if (buffer.length < SEAL_HEADER.length + SEAL_TAIL_A || buffer[buffer.length - 1] !== 0x0a) return bad(10, "format");
  const text = buffer.toString("latin1");
  const at = (offset: number) => text.slice(text.length - offset);

  // Form B zuerst: Der Schwanz beginnt 610 Bytes vor dem Ende mit „signing-key “ und hat an der festen Stelle „endorsement “
  const tryB = buffer.length >= SEAL_TAIL_B + SEAL_HEADER.length && at(SEAL_TAIL_B).startsWith("signing-key ") && at(SEAL_TAIL_B - KEY_LINE).startsWith("endorsement ");
  const tail = at(tryB ? SEAL_TAIL_B : SEAL_TAIL_A);
  if (!tail.startsWith("signing-key ") || tail[KEY_LINE - 1] !== "\n") return bad(10, "tail");
  const keyHex = tail.slice(12, 12 + 64);
  const sigLine = tail.slice(tail.length - SIGNATURE_LINE);
  if (!sigLine.startsWith("signature ") || !HEX(128).test(sigLine.slice(10, 138)) || sigLine[138] !== "\n" || !HEX(64).test(keyHex)) return bad(10, "tail");
  const signingKey = Buffer.from(keyHex, "hex");
  const isRelease = signingKey.equals(trust.releaseKey);
  let endorsedUntil: string | undefined;

  if (tryB) {
    const eLine = tail.slice(KEY_LINE, KEY_LINE + ENDORSEMENT_LINE);
    const sLine = tail.slice(KEY_LINE + ENDORSEMENT_LINE, KEY_LINE + ENDORSEMENT_LINE + ENDORSEMENT_SIG_LINE);
    const eHex = eLine.slice(12, 12 + ENDORSEMENT_STATEMENT_BYTES * 2);
    const sHex = sLine.slice(16, 16 + 128);
    if (!eLine.startsWith("endorsement ") || eLine[eLine.length - 1] !== "\n" || !HEX(ENDORSEMENT_STATEMENT_BYTES * 2).test(eHex)) return bad(10, "tail");
    if (!sLine.startsWith("endorsement-sig ") || sLine[sLine.length - 1] !== "\n" || !HEX(128).test(sHex)) return bad(10, "tail");
    if (isRelease) return bad(11, "endorsement-for-release-key");
    const statement = Buffer.from(eHex, "hex");
    const signature = Buffer.from(sHex, "hex");
    const endorsed = verifyEndorsementBytes(statement, signature, trust.rootKey, now);
    if (!endorsed) {
      const ignoringExpiry = now ? verifyEndorsementBytes(statement, signature, trust.rootKey, null) : null;
      return bad(11, ignoringExpiry ? "endorsement-expired" : "endorsement-invalid");
    }
    if (!endorsed.key.equals(signingKey)) return bad(11, "endorsement-other-key");
    endorsedUntil = endorsed.validUntil;
  } else if (!isRelease) return bad(11, "unknown-key");

  const signedLength = buffer.length - SIGNATURE_LINE;
  let valid = false;
  try {
    valid = verify(null, Buffer.concat([Buffer.from(SEAL_CONTEXT), buffer.subarray(0, signedLength)]), rawKeyToObject(signingKey), Buffer.from(sigLine.slice(10, 138), "hex"));
  } catch {
    valid = false;
  }
  if (!valid) return bad(11, "bad-signature");

  // Erst jetzt (die Bytes sind echt) wird der Rumpf gelesen
  const bodyEnd = buffer.length - (tryB ? SEAL_TAIL_B : SEAL_TAIL_A);
  const lines = text.slice(0, bodyEnd).split("\n");
  if (lines.pop() !== "" || lines.length !== 8 || lines[0] + "\n" !== SEAL_HEADER) return bad(10, "body");
  const names = ["version", "base", "arch", "tree-sha512", "tree-size", "tree-entries", "tree-bytes"];
  const values: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const prefix = `${names[i]} `;
    const line = lines[i + 1];
    if (!line.startsWith(prefix)) return bad(10, `body:${names[i]}`);
    values.push(line.slice(prefix.length));
  }
  const [version, base, arch, treeSha512, treeSize, treeEntries, treeBytes] = values;
  if (!VERSION_PATTERN.test(version) || !/^[1-9][0-9]{0,5}$/.test(base) || !ARCH_PATTERN.test(arch) || !HEX(128).test(treeSha512)) return bad(10, "body:value");
  if (![treeSize, treeEntries, treeBytes].every((v) => NUMBER_PATTERN.test(v))) return bad(10, "body:value");
  if (Number(treeSize) > TREE_LIMITS.maxTreeBytes || Number(treeEntries) > TREE_LIMITS.maxEntries) return bad(10, "body:limit");
  return {
    ok: true,
    seal: { version, base: Number(base), arch, treeSha512, treeSize: Number(treeSize), treeEntries: Number(treeEntries), treeBytes: Number(treeBytes), signingKey: keyHex, ...(endorsedUntil ? { endorsedUntil } : {}) },
  };
}

// ───────── Vollständige Prüfung einer Version (Referenzprüfer) ─────────

/**
 * Prüf-Exit-Codes von `/bootstrap --verify` (und dieses Referenzprüfers); die Klassen bestimmen, was der Aufrufer tut:
 *  ok · negativ (Integrität: Marker, Version wird verworfen) · veraltet/unverträglich (kein Alarm, keine Marke) · unklar (Betriebsfehler, nächster Start versucht es erneut).
 */
export const VERIFY_EXIT = {
  ok: 0,
  usage: 2,
  sealMissing: 10, // Siegel fehlt oder ist formal fehlerhaft
  signature: 11, // Signatur, Kette, unbekannter Schlüssel, abgelaufene Beglaubigung (nur mit --check-expiry)
  version: 12, // Version im Siegel ≠ Ordnername / --expect-version
  treeHash: 13, // SOS-TREE passt nicht zum Siegel (Hash, Größe, Format, Zähler)
  missing: 14,
  extra: 15,
  differs: 16,
  io: 17, // unklar
  outside: 18, // node_modules in einem Vorfahrenordner (Modulauflösung verließe den geprüften Baum)
  outdated: 19, // veraltet oder unverträglich: Version ≤ Untergrenze, base oder arch passen nicht
} as const;

export type VerifyClass = "ok" | "negative" | "benign" | "inconclusive";

/** Ordnet das Ende eines Prüfprozesses ein: Exit-Code (oder `null` bei Signal/Zeitüberschreitung). Alles Unbekannte ist „unklar“ – nie „negativ“. */
export function classifyVerifyExit(code: number | null): VerifyClass {
  if (code === 0) return "ok";
  if (code === null) return "inconclusive";
  if ((code >= 10 && code <= 16) || code === 18) return "negative";
  if (code === 19) return "benign";
  return "inconclusive";
}

export type VerifyFailure = { ok: false; code: number; reason: string; path?: string };
export type VerifySuccess = { ok: true; version: string; files: number; bytes: number; ms: number; floor: "below" | "equal" | "above" | "none"; endorsedUntil?: string };

export type VerifyOptions = {
  /** Der Baum der Version (Wurzel = das Versionsverzeichnis) */
  fs: FsLike;
  trust: { releaseKey: Buffer; rootKey: Buffer };
  /** Name des Versionsordners bzw. `--expect-version`: muss der Version im Siegel entsprechen */
  expectVersion: string;
  /** Erwartete Werte des Images (aus dessen version.json) – Abweichung = veraltet/unverträglich (19) */
  image?: { base: number; arch: string };
  /** Untergrenze: die eingebaute Version. Fehlt sie, wird nicht geprüft. */
  floor?: string;
  /** `false`: Untergrenze nur melden (`--verify` der Echtprobe), nicht erzwingen */
  enforceFloor?: boolean;
  /** Ablauf der Beglaubigung gegen dieses Datum prüfen (`--check-expiry`); `null`/fehlt = nicht prüfen (so liest der Starter) */
  checkExpiry?: Date | null;
  /** Prüft die Vorfahrenordner auf `node_modules`; liefert den gefundenen Pfad oder `null` (Code 18) */
  ancestorProbe?: () => Promise<string | null>;
  onProgress?: (bytesRead: number) => void;
  now?: () => number;
};

/** Reihenfolge wie im Starter: Vorfahren → Untergrenze (Ordnername) → Siegel → Version/base/arch → Liste → Baum. */
export async function verifyVersion(options: VerifyOptions): Promise<VerifySuccess | VerifyFailure> {
  const clock = options.now ?? Date.now;
  const started = clock();
  const fail = (code: number, reason: string, path?: string): VerifyFailure => ({ ok: false, code, reason, ...(path !== undefined ? { path } : {}) });
  try {
    const found = await options.ancestorProbe?.();
    if (found) return fail(VERIFY_EXIT.outside, "node_modules-in-ancestor", found);

    const floor = options.floor ? floorOf(options.floor) : null;
    // Ordnername bzw. --expect-version: streng `x.y.z` wie die Version im Siegel (keine führenden Nullen, höchstens 9 Ziffern je Zahl, keine Vorabversion) – der C-Prüfer rechnet damit in Zahlen
    const folderMatch = VERSION_PATTERN.exec(options.expectVersion);
    const folder = folderMatch ? { major: Number(folderMatch[1]), minor: Number(folderMatch[2]), patch: Number(folderMatch[3]) } : null;
    const enforce = options.enforceFloor !== false;
    if (!folder) return fail(VERIFY_EXIT.version, "folder-name");
    if (floor && enforce && !exceedsFloor(folder, floor)) return fail(VERIFY_EXIT.outdated, "floor");

    const sealStat = await options.fs.lstat(SEAL_FILE);
    if (!sealStat || sealStat.kind !== "file") return fail(VERIFY_EXIT.sealMissing, "seal-missing");
    const sealBytes = await options.fs.readFile(SEAL_FILE, SEAL_MAX_BYTES);
    if (!sealBytes) return fail(VERIFY_EXIT.sealMissing, "too-large");
    const sealResult = verifySeal(sealBytes, options.trust, options.checkExpiry ?? null);
    if (!sealResult.ok) return fail(sealResult.code, sealResult.reason);
    const seal = sealResult.seal;

    if (seal.version !== options.expectVersion) return fail(VERIFY_EXIT.version, "seal-version");
    if (options.image && (seal.base !== options.image.base || seal.arch !== options.image.arch)) return fail(VERIFY_EXIT.outdated, seal.base !== options.image.base ? "base" : "arch");

    const treeStat = await options.fs.lstat(TREE_FILE);
    if (!treeStat || treeStat.kind !== "file") return fail(VERIFY_EXIT.treeHash, "tree-missing");
    if (treeStat.size !== seal.treeSize) return fail(VERIFY_EXIT.treeHash, "tree-size");
    const treeBytes = await options.fs.readFile(TREE_FILE, seal.treeSize);
    if (!treeBytes || treeBytes.length !== seal.treeSize || sha512Hex(treeBytes) !== seal.treeSha512) return fail(VERIFY_EXIT.treeHash, "tree-hash");
    let entries;
    try {
      entries = parseTree(treeBytes);
    } catch (error) {
      return fail(VERIFY_EXIT.treeHash, "tree-format", error instanceof TreeError ? error.path : undefined);
    }
    const stats = treeStats(entries);
    if (stats.entries !== seal.treeEntries || stats.bytes !== seal.treeBytes) return fail(VERIFY_EXIT.treeHash, "tree-counts");

    const failure: TreeFailure | null = await verifyTreeAgainstFs(options.fs, entries, options.onProgress);
    if (failure) return fail(failure.code, failure.reason, failure.path);

    return {
      ok: true,
      version: seal.version,
      files: stats.entries,
      bytes: stats.bytes,
      ms: clock() - started,
      floor: floor ? (compareVersions(seal.version, options.floor!) > 0 ? "above" : compareVersions(seal.version, options.floor!) === 0 ? "equal" : "below") : "none",
      ...(seal.endorsedUntil ? { endorsedUntil: seal.endorsedUntil } : {}),
    };
  } catch (error) {
    if (error instanceof TreeError && error.code === "io") return fail(VERIFY_EXIT.io, "io", error.path);
    return fail(VERIFY_EXIT.io, "io");
  }
}

// ───────── Vorfahren-Regel (Arch F1) ─────────

/**
 * Node löst `require()` aufwärts auf (`<v>/node_modules`, dann `versions/node_modules`, `app/node_modules`, `<DATA_DIR>/node_modules` …). Alles, was dort liegt, wäre
 * Code, den der geprüfte Baum nicht erfasst (Next lädt optionale Pakete wie `@opentelemetry/api` mit `try { require(…) }`). Darum darf es in den Vorfahrenordnern
 * des Versionsordners **bis einschließlich** `dataDir` kein `node_modules` geben (Datei, Ordner oder Link). Liefert den ersten Fund (Pfad) oder `null`.
 */
export async function findNodeModulesAncestor(versionDir: string, dataDir: string, probe: (candidate: string) => Promise<boolean>): Promise<string | null> {
  const stop = dataDir.replace(/[\\/]+$/, "");
  let dir = versionDir.replace(/[\\/]+$/, "");
  const normalize = (p: string) => p.replace(/\\/g, "/");
  if (!normalize(dir).startsWith(normalize(stop) + "/")) return null; // außerhalb des Datenverzeichnisses: nichts zu prüfen
  for (let i = 0; i < 64; i++) {
    const parent = dir.slice(0, Math.max(dir.lastIndexOf("/"), dir.lastIndexOf("\\")));
    if (!parent) return null;
    const candidate = `${parent}/node_modules`;
    if (await probe(candidate)) return candidate;
    if (normalize(parent) === normalize(stop)) return null;
    dir = parent;
  }
  return null;
}
