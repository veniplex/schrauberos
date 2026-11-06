/**
 * Schlüsselkette für Release-Signaturen – reine Funktionen (nur `node:crypto`), von App und Release-Skripten genutzt.
 *
 *   Wurzelschlüssel (im Code/Image, privater Teil offline)  ──beglaubigt──▶  Release-Schlüssel  ──signiert──▶  Manifest
 *
 * Der **Wurzelschlüssel** steht fest im Code (`release-key.ts`). Er signiert nur *Beglaubigungen* für Release-Schlüssel, nie
 * Pakete. Der **Release-Schlüssel** (privat als GitHub-Secret) signiert die Manifeste. Die Kette löst **ein** Problem: den
 * *Verlust* des Release-Schlüssels (oder seinen planmäßigen Wechsel). Dann beglaubigt der Wurzelschlüssel einen neuen, ohne dass
 * jede Installation ein neues Image braucht: Die Beglaubigung wird mit dem Release ausgeliefert, die App prüft die Kette und merkt
 * sie sich im Datenverzeichnis (`<DATA_DIR>/app/release-keys.json`).
 *
 * **Was die Kette nicht leistet:** Der im Image eingebaute Release-Schlüssel (`RELEASE_PUBLIC_KEY`) bleibt für diese Installationen
 * **immer vertraut**. Wird sein privater Teil gestohlen (Kompromittierung), kann der Dieb weiterhin gültige Manifeste signieren; eine
 * Beglaubigung für einen neuen Schlüssel entzieht dem alten das Vertrauen nicht. Dagegen bräuchte es eine Widerrufsliste oder einen
 * neuen Wurzelschlüssel samt neuem Image (die Installationen ziehen es einmal von Hand). Wer das Secret `RELEASE_SIGNING_KEY` für
 * gestohlen hält, muss also ein neues Image veröffentlichen, nicht nur rotieren.
 *
 * Eine Beglaubigung ist `{ statement, signature }` (beide base64): `statement` sind die exakten JSON-Bytes
 * `{"schema":1,"publicKey":"<PEM>","validUntil":"<JJJJ-MM-TT>"}`; `validUntil` ist **Pflicht** (eine unbefristete Beglaubigung gilt
 * nicht, sonst bliebe ein einmal beglaubigter Schlüssel für immer gültig); die Signatur des Wurzelschlüssels gilt für
 * `ENDORSEMENT_CONTEXT + statement` (so lässt sich eine Beglaubigung nie mit einer Manifest-Signatur verwechseln).
 */
import { createPublicKey, sign, verify } from "node:crypto";

export const ENDORSEMENT_CONTEXT = "schrauberos-release-key-endorsement-v1\n";

export type Endorsement = { statement: string; signature: string };

const ownKey = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length < 4096;

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
 * Signatur nicht stimmt, die Aussage ungültig oder die Beglaubigung abgelaufen ist.
 */
export function verifyEndorsement(endorsement: Endorsement, rootPem: string, now: Date = new Date()): string | null {
  try {
    const statement = Buffer.from(endorsement.statement, "base64");
    const signature = Buffer.from(endorsement.signature, "base64");
    if (!verify(null, Buffer.concat([Buffer.from(ENDORSEMENT_CONTEXT), statement]), createPublicKey(rootPem), signature)) return null;
    const data = JSON.parse(statement.toString("utf8")) as { schema?: unknown; publicKey?: unknown; validUntil?: unknown };
    if (data.schema !== 1 || !ownKey(data.publicKey)) return null;
    // Pflicht: eine Beglaubigung ohne (oder mit unlesbarem) Ablaufdatum gilt nicht
    if (typeof data.validUntil !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.validUntil)) return null;
    const end = Date.parse(`${data.validUntil}T23:59:59Z`);
    if (Number.isNaN(end) || now.getTime() > end) return null;
    createPublicKey(data.publicKey); // muss ein lesbarer Schlüssel sein
    return data.publicKey;
  } catch {
    return null;
  }
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

function samePublicKey(a: string, b: string): boolean {
  try {
    const der = (pem: string) => createPublicKey(pem).export({ type: "spki", format: "der" });
    return Buffer.compare(der(a), der(b)) === 0;
  } catch {
    return false;
  }
}

/** Erzeugt eine Beglaubigung (für das Skript `scripts/endorse-release-key.mjs`; der Wurzel-Schlüssel kommt nie in die App). */
export function createEndorsement(rootPrivatePem: string, releasePublicPem: string, validUntil: string): Endorsement {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || Number.isNaN(Date.parse(`${validUntil}T23:59:59Z`))) throw new Error("validUntil (JJJJ-MM-TT) ist Pflicht.");
  const statement = Buffer.from(JSON.stringify({ schema: 1, publicKey: releasePublicPem, validUntil }));
  const signature = sign(null, Buffer.concat([Buffer.from(ENDORSEMENT_CONTEXT), statement]), rootPrivatePem);
  return { statement: statement.toString("base64"), signature: signature.toString("base64") };
}

/**
 * Ist die Schlüsselausstattung für einen Release brauchbar? Solange der Wurzelschlüssel fehlt oder derselbe wie der Release-Schlüssel
 * ist, schützt die Kette nicht: Wer das GitHub-Secret hat, kann zugleich beglaubigen. Das Release-Skript bricht dann ab.
 */
export function rootKeyProblem(releasePem: string, rootPem: string | undefined): "root-missing" | "root-equals-release" | null {
  if (!rootPem) return "root-missing";
  return samePublicKey(releasePem, rootPem) ? "root-equals-release" : null;
}
