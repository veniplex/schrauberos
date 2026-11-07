/**
 * Schlüsselkette für Release-Signaturen – reine Funktionen (nur `node:crypto`), von App, Release-Skripten und Tests genutzt. Nur löschbare
 * TypeScript-Syntax (keine Enums, keine Parameter-Eigenschaften): Die Skripte unter `scripts/` importieren diese Datei direkt (Node entfernt die Typen).
 *
 *   Wurzelschlüssel (im Code/Image, privater Teil offline)  ──beglaubigt──▶  Release-Schlüssel  ──signiert──▶  Manifest und Siegel
 *
 * Der **Wurzelschlüssel** steht fest im Code (`release-key.ts`). Er signiert nur *Beglaubigungen* für Release-Schlüssel, nie Pakete. Der
 * **Release-Schlüssel** (privat als GitHub-Secret) signiert die Manifeste und die Siegel (`SOS-SEAL`, siehe `tree.ts`). Die Kette löst **ein**
 * Problem: den *Verlust* des Release-Schlüssels (oder seinen planmäßigen Wechsel). Dann beglaubigt der Wurzelschlüssel einen neuen, ohne dass
 * jede Installation ein neues Image braucht: Die Beglaubigung wird mit dem Release ausgeliefert (die App merkt sie sich im Datenverzeichnis, `<DATA_DIR>/app/release-keys.json`)
 * und steckt **im Siegel jeder installierten Version**, sodass der Starter im Image sie ohne diese Datei prüfen kann.
 *
 * **Was die Kette nicht leistet:** Der im Image eingebaute Release-Schlüssel (`RELEASE_PUBLIC_KEY`) bleibt für diese Installationen
 * **immer vertraut**. Wird sein privater Teil gestohlen (Kompromittierung), kann der Dieb weiterhin gültige Manifeste und Siegel signieren; eine
 * Beglaubigung für einen neuen Schlüssel entzieht dem alten das Vertrauen nicht. Dagegen bräuchte es einen neuen Wurzelschlüssel samt neuem Image
 * (die Installationen ziehen es einmal von Hand). Wer das Secret `RELEASE_SIGNING_KEY` für gestohlen hält, muss also ein neues Image veröffentlichen,
 * nicht nur rotieren.
 *
 * **Beglaubigung, Format 2** (zeilenbasiert, genau diese 118 Bytes; der C-Prüfer im Starter baut dieselben Bytes nach und vergleicht, statt zu parsen):
 *
 *     schrauberos-endorsement 2\n
 *     key <64 Hex: roher Ed25519-Schlüssel, Kleinbuchstaben>\n
 *     valid-until <JJJJ-MM-TT>\n
 *
 * Die Signatur des Wurzelschlüssels gilt für `ENDORSEMENT_CONTEXT + Aussage` (so lässt sich eine Beglaubigung nie mit einer Manifest- oder
 * Siegel-Signatur verwechseln). `valid-until` ist **Pflicht**: Die App (Installer, `trustedReleaseKeys`) prüft es gegen die Uhr; der Starter prüft den
 * Ablauf **nicht** (sonst würde eine ordentlich installierte Version nach dem Stichtag still auf eine ältere zurückfallen), nur auf ausdrücklichen
 * Wunsch (`--check-expiry`). Als Datei `release-keys.json` und im Release steht eine Beglaubigung weiter als `{ statement, signature }` (beide base64).
 */
import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";

export const ENDORSEMENT_CONTEXT = "schrauberos-release-key-endorsement-v2\n";
/** Vorangestellt, wenn das Manifest signiert wird: eine Manifest-Signatur ist nie mit einer Beglaubigung oder einem Siegel verwechselbar. */
export const MANIFEST_CONTEXT = "schrauberos-manifest-v1\n";
export const ENDORSEMENT_MAGIC = "schrauberos-endorsement 2\n";

export type Endorsement = { statement: string; signature: string };

/** Länge der Beglaubigungs-Aussage in Bytes (fest). */
export const ENDORSEMENT_STATEMENT_BYTES = ENDORSEMENT_MAGIC.length + "key ".length + 64 + 1 + "valid-until ".length + 10 + 1;

const ownKey = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length < 4096;

// ───────── Schlüssel: PEM ↔ roh ─────────

/** DER-Präfix eines Ed25519-SubjectPublicKeyInfo; danach folgen die 32 rohen Schlüsselbytes. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Roher Ed25519-Schlüssel (32 Bytes) aus einem PEM; `null`, wenn es kein Ed25519-SPKI genau dieser Form ist. */
export function pemToRawKey(pem: string): Buffer | null {
  try {
    const der = createPublicKey(pem).export({ type: "spki", format: "der" });
    if (der.length !== SPKI_PREFIX.length + 32 || !der.subarray(0, SPKI_PREFIX.length).equals(SPKI_PREFIX)) return null;
    return Buffer.from(der.subarray(SPKI_PREFIX.length));
  } catch {
    return null;
  }
}

export function rawKeyToObject(raw: Buffer): KeyObject {
  if (raw.length !== 32) throw new Error("Ein Ed25519-Schlüssel hat 32 Bytes.");
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

export function rawKeyToPem(raw: Buffer): string {
  return rawKeyToObject(raw).export({ type: "spki", format: "pem" }).toString();
}

// ───────── Beglaubigung ─────────

/** Ist das ein echtes Kalenderdatum `JJJJ-MM-TT`? (`Date.parse` nähme auch den 30. Februar.) */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Ende des Gültigkeitstages (UTC, 23:59:59). */
export const endOfDay = (validUntil: string): number => Date.parse(`${validUntil}T23:59:59Z`);

/** Die Bytes der Aussage; `keyHex` sind 64 Kleinbuchstaben-Hexziffern. */
export function endorsementStatement(keyHex: string, validUntil: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error("key: 64 Hexziffern erwartet.");
  if (!isCalendarDate(validUntil)) throw new Error("validUntil (JJJJ-MM-TT) ist Pflicht.");
  return Buffer.from(`${ENDORSEMENT_MAGIC}key ${keyHex}\nvalid-until ${validUntil}\n`, "utf8");
}

/**
 * Liest eine Aussage, indem die Bytes aus den beiden Feldern **nachgebaut** und verglichen werden (kein Parser mit Spielraum: feste Länge, feste Reihenfolge,
 * nur Kleinbuchstaben-Hex). Genau so macht es der C-Prüfer im Starter.
 */
export function parseEndorsementStatement(bytes: Buffer): { key: Buffer; validUntil: string } | null {
  if (bytes.length !== ENDORSEMENT_STATEMENT_BYTES) return null;
  const text = bytes.toString("latin1");
  const keyHex = text.slice(ENDORSEMENT_MAGIC.length + 4, ENDORSEMENT_MAGIC.length + 4 + 64);
  const validUntil = text.slice(text.length - 11, text.length - 1);
  if (!/^[0-9a-f]{64}$/.test(keyHex) || !isCalendarDate(validUntil)) return null;
  if (!endorsementStatement(keyHex, validUntil).equals(bytes)) return null;
  return { key: Buffer.from(keyHex, "hex"), validUntil };
}

/**
 * Prüft Aussage und Signatur gegen den Wurzelschlüssel (roh). `now = null`: Ablauf nicht prüfen (so liest der Starter); sonst gilt die Beglaubigung bis zum
 * Ende des Tages `valid-until`. Liefert den beglaubigten Schlüssel (roh) oder `null`.
 */
export function verifyEndorsementBytes(statement: Buffer, signature: Buffer, rootRaw: Buffer, now: Date | null): { key: Buffer; validUntil: string } | null {
  try {
    const parsed = parseEndorsementStatement(statement);
    if (!parsed || signature.length !== 64) return null;
    if (!verify(null, Buffer.concat([Buffer.from(ENDORSEMENT_CONTEXT), statement]), rawKeyToObject(rootRaw), signature)) return null;
    if (now && now.getTime() > endOfDay(parsed.validUntil)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Liest eine unbekannte JSON-Struktur (Datei oder Release-Asset) in eine Liste formal gültiger Beglaubigungen. */
export function parseEndorsements(raw: unknown): Endorsement[] {
  const list = raw && typeof raw === "object" && "keys" in raw ? (raw as { keys: unknown }).keys : raw;
  if (!Array.isArray(list)) return [];
  const out: Endorsement[] = [];
  for (const item of list.slice(0, 20)) {
    if (item && typeof item === "object" && ownKey((item as Endorsement).statement) && ownKey((item as Endorsement).signature)) {
      out.push({ statement: (item as Endorsement).statement, signature: (item as Endorsement).signature });
    }
  }
  return out;
}

/**
 * Prüft eine Beglaubigung gegen den Wurzelschlüssel. Liefert den beglaubigten öffentlichen Schlüssel (PEM) oder null, wenn die
 * Signatur nicht stimmt, die Aussage ungültig oder die Beglaubigung abgelaufen ist (`now = null` prüft den Ablauf nicht).
 */
export function verifyEndorsement(endorsement: Endorsement, rootPem: string, now: Date | null = new Date()): string | null {
  const rootRaw = pemToRawKey(rootPem);
  if (!rootRaw) return null;
  const ok = verifyEndorsementBytes(Buffer.from(endorsement.statement, "base64"), Buffer.from(endorsement.signature, "base64"), rootRaw, now);
  return ok ? rawKeyToPem(ok.key) : null;
}

/** Alle Schlüssel, die Manifeste signieren dürfen: die eingebauten plus die vom Wurzelschlüssel beglaubigten. */
export function trustedReleaseKeys(options: { root: string; builtIn: readonly string[]; endorsements: readonly Endorsement[]; now?: Date }): string[] {
  const keys = [...options.builtIn];
  for (const e of options.endorsements) {
    const key = verifyEndorsement(e, options.root, options.now);
    if (key && !keys.some((k) => samePublicKey(k, key))) keys.push(key);
  }
  return keys;
}

/** Beglaubigungen aus `offered`, die die Kette bestehen, ohne Doppelte (zum Merken im Datenverzeichnis). */
export const validEndorsements = (offered: readonly Endorsement[], root: string, now?: Date): Endorsement[] =>
  offered.filter((e, i) => offered.findIndex((o) => o.statement === e.statement) === i && verifyEndorsement(e, root, now) !== null);

export function samePublicKey(a: string, b: string): boolean {
  try {
    const der = (pem: string) => createPublicKey(pem).export({ type: "spki", format: "der" });
    return Buffer.compare(der(a), der(b)) === 0;
  } catch {
    return false;
  }
}

/** Erzeugt eine Beglaubigung (für das Skript `scripts/endorse-release-key.mjs`; der Wurzel-Schlüssel kommt nie in die App). */
export function createEndorsement(rootPrivatePem: string, releasePublicPem: string, validUntil: string): Endorsement {
  if (!isCalendarDate(validUntil)) throw new Error("validUntil (JJJJ-MM-TT) ist Pflicht.");
  const raw = pemToRawKey(releasePublicPem);
  if (!raw) throw new Error("Der Release-Schlüssel ist kein Ed25519-Schlüssel.");
  const statement = endorsementStatement(raw.toString("hex"), validUntil);
  const signature = sign(null, Buffer.concat([Buffer.from(ENDORSEMENT_CONTEXT), statement]), rootPrivatePem);
  return { statement: statement.toString("base64"), signature: signature.toString("base64") };
}

// ───────── Manifest ─────────

/** Die Bytes, die beim Signieren/Prüfen eines Manifests tatsächlich unterschrieben werden (Kontext + Manifest). */
export const manifestSignedBytes = (manifestBytes: Buffer): Buffer => Buffer.concat([Buffer.from(MANIFEST_CONTEXT), manifestBytes]);

/**
 * Ist die Schlüsselausstattung für einen Release brauchbar? Solange der Wurzelschlüssel fehlt oder derselbe wie der Release-Schlüssel
 * ist, schützt die Kette nicht: Wer das GitHub-Secret hat, kann zugleich beglaubigen. Das Release-Skript bricht dann ab.
 */
export function rootKeyProblem(releasePem: string, rootPem: string | undefined): "root-missing" | "root-equals-release" | null {
  if (!rootPem) return "root-missing";
  return samePublicKey(releasePem, rootPem) ? "root-equals-release" : null;
}
