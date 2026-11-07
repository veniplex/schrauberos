import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { formatRecoveryKey } from "@/lib/recovery-key";
import { deriveOffsiteMasterKey, secretKeyCheck, WRAPPED_SETTING_KEY, wrapSecretKey } from "@/lib/secret-wrap";
import { KEY_CHECK_SETTING } from "@/server/secret-key-issue";
import { readSecretKey, secretKeyHex } from "@/server/secrets";
import { db } from "@/server/db";
import { getSecret, setSecret, setSetting } from "@/server/settings";

/**
 * Wiederherstellungsschlüssel (P1b-4a): **ein Schlüssel für alles**.
 *
 * `secret.key` (verschlüsselt alle Geheimnisse der Datenbank: Update-Token, Zugangsdaten, TOTP …) liegt bewusst außerhalb der Backups. Damit ein Backup nach dem Verlust des
 * Datenträgers trotzdem wieder lesbar wird, erzeugt ein Administrator einen zufälligen 256-Bit-Wiederherstellungsschlüssel, der **einmalig** angezeigt und nie gespeichert wird.
 * In der Datenbank (und damit in jedem Backup) liegt nur
 *  - eine Kopie von `secret.key`, mit diesem Schlüssel umhüllt (HKDF + AES-256-GCM, `lib/secret-wrap.ts`),
 *  - ein Kennwert von `secret.key` (erkennt, ob die Hülle noch zum Schlüssel dieses Datenträgers gehört),
 *  - der aus dem Schlüssel abgeleitete Hauptschlüssel der Off-Site-Verschlüsselung, selbst mit `secret.key` verschlüsselt (damit der Server unbeaufsichtigt sichern kann).
 * Der Klartext des Schlüssels steht nur in der Antwort der erzeugenden Aktion – nie in URL, Log, Audit oder Datenbank.
 */
type Writer = Pick<PrismaClient | Prisma.TransactionClient, "appSetting">;

/** Lesen über den Client des Aufrufers (innerhalb einer Transaktion nie über `db`: SQLite hat nur einen Schreiber). */
const read = async (client: Writer, key: string): Promise<string | null> => (await client.appSetting.findUnique({ where: { key } }))?.value ?? null;

const WRAPPED = WRAPPED_SETTING_KEY;
const CHECK = KEY_CHECK_SETTING;
const CREATED = "secrets.keyCreatedAt";
const CONFIRMED = "secrets.keyConfirmedAt";
/** Geheimnis (mit `secret.key` verschlüsselt): Hauptschlüssel der Off-Site-Verschlüsselung, Hex */
export const OFFSITE_MASTER_SECRET = "secrets.offsiteMaster";

/** Neuen Wiederherstellungsschlüssel erzeugen; ersetzt Hülle, Kennwert und Off-Site-Hauptschlüssel und setzt „gesichert“ zurück. Gibt den Klartext zurück (nur zur einmaligen Anzeige). */
export async function issueRecoveryKey(client: Writer): Promise<string> {
  const key = randomBytes(32);
  const secret = secretKeyHex();
  await setSetting(WRAPPED, wrapSecretKey(secret, key), client);
  await setSetting(CHECK, secretKeyCheck(secret), client);
  await setSetting(CREATED, new Date().toISOString(), client);
  await setSetting(CONFIRMED, null, client);
  await setSecret(OFFSITE_MASTER_SECRET, deriveOffsiteMasterKey(key).toString("hex"), client);
  return formatRecoveryKey(key);
}

export type RecoveryKeyStatus = {
  exists: boolean;
  createdAt: Date | null;
  confirmed: boolean;
  /** Die Hülle gehört nicht (mehr) zum Schlüssel dieses Datenträgers (Restore ohne Schlüssel): ein neuer Wiederherstellungsschlüssel ist nötig */
  stale: boolean;
};

export async function recoveryKeyStatus(client: Writer = db): Promise<RecoveryKeyStatus> {
  const [wrapped, check, created, confirmed] = await Promise.all([read(client, WRAPPED), read(client, CHECK), read(client, CREATED), read(client, CONFIRMED)]);
  if (!wrapped) return { exists: false, createdAt: null, confirmed: false, stale: false };
  // Nicht lesbar ist nicht „veraltet“: ohne lesbaren Schlüssel lässt sich nichts vergleichen, und eine Hülle darf deshalb nie entfernt werden (siehe `secret-key-issue.ts`)
  const key = readSecretKey();
  const stale = key.state === "readable" && check !== secretKeyCheck(key.hex);
  return { exists: !stale, createdAt: created ? new Date(created) : null, confirmed: !!confirmed && !stale, stale };
}

/** Ist der Wiederherstellungsschlüssel erzeugt **und** als gesichert bestätigt? (Die Einrichtungs-Checkliste mahnt, bis das so ist; Off-Site-Backup verlangt es.) */
export async function recoveryKeyConfirmed(client: Writer = db): Promise<boolean> {
  return (await recoveryKeyStatus(client)).confirmed;
}

/** „Ich habe den Schlüssel gesichert“. Gibt false zurück, wenn es keinen (gültigen) Schlüssel zu bestätigen gibt. */
export async function confirmRecoveryKey(client: Writer): Promise<boolean> {
  const status = await recoveryKeyStatus(client);
  if (!status.exists) return false;
  if (!status.confirmed) await setSetting(CONFIRMED, new Date().toISOString(), client);
  return true;
}

/** Entfernt eine veraltete Hülle (gehört nicht zum Schlüssel dieses Datenträgers). Gibt zurück, ob etwas entfernt wurde. */
export async function dropStaleRecoveryKey(client: Writer): Promise<boolean> {
  if (!(await recoveryKeyStatus(client)).stale) return false;
  for (const key of [WRAPPED, CHECK, CREATED, CONFIRMED]) await setSetting(key, null, client);
  return true;
}

/** Hauptschlüssel der Off-Site-Verschlüsselung (null: kein Wiederherstellungsschlüssel erzeugt oder nicht lesbar). */
export async function getOffsiteMasterKey(): Promise<Buffer | null> {
  const hex = await getSecret(OFFSITE_MASTER_SECRET);
  return hex && /^[0-9a-f]{64}$/.test(hex) ? Buffer.from(hex, "hex") : null;
}
