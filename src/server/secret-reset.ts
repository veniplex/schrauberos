import "server-only";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { logError } from "@/lib/log-safe";
import { WRAPPED_SETTING_KEY } from "@/lib/secret-wrap";
import { readApplied } from "@/lib/updates/restore";
import { dataDir } from "@/lib/updates/store";
import { featureSecretConsumers } from "@/modules/secrets";
import { audit } from "@/server/audit";
import { resetUnreadableSecondFactors } from "@/server/auth/second-factor";
import { db } from "@/server/db";
import { dropStaleRecoveryKey } from "@/server/recovery-key";
import { KEY_CHECK_SETTING, secretKeyIssue } from "@/server/secret-key-issue";
import { createSecretKey, isForeignSecret, readSecretKey, SecretKeyUnavailableError } from "@/server/secrets";
import type { SecretConsumerDef } from "@/server/secret-consumers";
import { setSetting } from "@/server/settings";

/**
 * Alle Verbraucher von `secret.key` (Register: `secret-consumers.ts`): Plattform und Funktionen. Der zweite Faktor (TOTP) gehört zur Plattform.
 */
export const platformSecretConsumers: readonly SecretConsumerDef[] = [{ id: "auth.totp", resetUnreadable: resetUnreadableSecondFactors }];

export const allSecretConsumers = (): readonly SecretConsumerDef[] => [...platformSecretConsumers, ...featureSecretConsumers];

export type SecretResetItem = { id: string; count: number };
export type SecretResetNotice = {
  at: string;
  items: SecretResetItem[];
  /** Die Hülle des Wiederherstellungsschlüssels gehörte nicht zu diesem Datenträger und wurde entfernt */
  keyDropped: boolean;
  /** Dateiname der Sicherung der betroffenen Zeilen (`secret-reset/<Name>` im Datenverzeichnis) */
  backup?: string;
};

const NOTICE_KEY = "secrets.resetNotice";
const WRAP_KEYS = [WRAPPED_SETTING_KEY, KEY_CHECK_SETTING, "secrets.keyCreatedAt", "secrets.keyConfirmedAt"];

export const secretResetDir = (data = dataDir()) => path.join(data, "secret-reset");

type Rows = { settings: Array<{ key: string; value: string }>; twoFactor: Array<Record<string, unknown>>; backupCodes: Array<Record<string, unknown>>; consumers?: Record<string, Array<Record<string, unknown>>> };

/**
 * Welche Zeilen würde ein Zurücksetzen anfassen? Nicht lesbare Geheimnisse in den Einstellungen und zweite Faktoren, deren Geheimnis bei lesbarem Schlüssel nicht
 * entschlüsselt werden kann (samt Sicherungscode-Hashes dieser Konten); bei `withWrap` auch die Hülle des Wiederherstellungsschlüssels (sie wird entfernt). `null`: nichts zu tun.
 * Nur Blobs, die ohnehin verschlüsselt in der Datenbank liegen – kein Klartext.
 * `failed`: Verbraucher, deren Zeilen sich **nicht sichern** ließen (Fehler in `affectedRows`): sie werden **nicht** zurückgesetzt (erst Sicherung, dann Zurücksetzen – ohne Sicherung kein Zurücksetzen), die
 * übrigen schon; der Fehler wird gemeldet (nur der Code), nie verschluckt, als wäre alles gut gegangen.
 */
async function collectAffected(withWrap: boolean, consumers: readonly SecretConsumerDef[]): Promise<{ rows: Rows | null; failed: ReadonlySet<string> }> {
  const settings = (await db.appSetting.findMany()).filter((row) => isForeignSecret(row.value) || (withWrap && WRAP_KEYS.includes(row.key)));
  const twoFactor = (await db.twoFactor.findMany()).filter((row) => (row.enabledAt || row.secret) && (!row.secret || isForeignSecret(row.secret)));
  // Zeilen von Verbrauchern mit eigenen Tabellen (IT-Tresor): ihre verschlüsselten Blöcke gehören in dieselbe Sicherung
  const own: Record<string, Array<Record<string, unknown>>> = {};
  const failed = new Set<string>();
  for (const consumer of consumers) {
    if (!consumer.affectedRows) continue;
    try {
      const rows = await consumer.affectedRows();
      if (rows.length > 0) own[consumer.id] = rows;
    } catch (error) {
      failed.add(consumer.id);
      logError(`secrets:affected:${consumer.id}`, error);
      console.error(`[secrets] ${consumer.id}: die betroffenen Zeilen ließen sich nicht sichern – dieser Verbraucher wird nicht zurückgesetzt.`);
    }
  }
  if (settings.length === 0 && twoFactor.length === 0 && Object.keys(own).length === 0) return { rows: null, failed };
  const backupCodes = twoFactor.length ? await db.twoFactorBackupCode.findMany({ where: { userId: { in: twoFactor.map((row) => row.userId) } } }) : [];
  return {
    rows: {
      settings: settings.map(({ key, value }) => ({ key, value })),
      twoFactor: twoFactor.map((row) => ({ ...row })),
      backupCodes: backupCodes.map((row) => ({ ...row })),
      ...(Object.keys(own).length > 0 ? { consumers: own } : {}),
    },
    failed,
  };
}

/** Schreibt die betroffenen Zeilen als Datei (Rechte 0600, nie überschrieben, nicht im Backup) – **vor** jedem Zurücksetzen; scheitert das, wird nichts zurückgesetzt. Gibt den Dateinamen zurück. */
function writeResetBackup(rows: Rows, reason: string, data = dataDir()): string {
  const dir = secretResetDir(data);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  const name = `${stamp}Z-${randomBytes(3).toString("hex")}.json`;
  const file = path.join(dir, name);
  const body = { version: 1, at: new Date().toISOString(), reason, note: "Nur bereits verschlüsselte Werte (kein Klartext); sie gehören zu dem Geheimnisschlüssel, der sie ursprünglich verschlüsselt hat.", ...rows };
  writeFileSync(file, JSON.stringify(body, null, 2), { mode: 0o600, flag: "wx" });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Dateisysteme ohne Modi */
  }
  return name;
}

export type ResetOptions = {
  /** Ausdrücklich durch die Administration veranlasst (Schaltfläche in Verwaltung → Backups → Schlüssel): auch ohne Wiederherstellung, auch bei veralteter Hülle */
  force?: boolean;
  /** Datenverzeichnis (nur für Tests; Standard: das laufende) */
  dataRoot?: string;
};

/**
 * Setzt Geheimnisse zurück, die der Schlüssel dieses Datenträgers **nicht entschlüsseln kann**. Das ist die Fehlerklasse „Datenverlust“, deshalb gilt:
 *  1. Nur bei **lesbarem** Schlüssel (fehlt er oder ist er nicht lesbar, ist nichts „fremd“, sondern nur gerade nicht erreichbar): sonst wird nie etwas gelöscht.
 *  2. Passt der Schlüssel nicht zur Hülle des Wiederherstellungsschlüssels in der Datenbank (`mismatch`: fremdes Volume), wäre mit dem Wiederherstellungsschlüssel noch
 *     alles zu retten – dann nur nach einer ausdrücklichen Wiederherstellung (`restore/applied.json`: die Person hat „ohne Schlüssel“ gewählt) oder auf ausdrückliche Anweisung (`force`).
 *  3. **Vorher** werden die betroffenen Zeilen (nur verschlüsselte Blobs) als Datei `secret-reset/<Zeit>.json` gesichert; gelingt das nicht, geschieht nichts.
 * Jeder Verbraucher setzt zurück, was er nicht mehr lesen kann; das Ergebnis erscheint im Audit-Log (nur Verbraucher und Anzahl, nie Inhalt) und für Administratoren als Hinweis, bis
 * sie ihn bestätigen. Eine veraltete Hülle des Wiederherstellungsschlüssels wird dabei entfernt – ein neuer Schlüssel ist nötig. Ein Fehler eines Verbrauchers hindert die anderen nicht.
 */
export async function resetUnreadableSecrets(consumers: readonly SecretConsumerDef[] = allSecretConsumers(), options: ResetOptions = {}): Promise<SecretResetItem[]> {
  const key = readSecretKey();
  if (key.state !== "readable") {
    console.error(`[secrets] secret.key ist ${key.state === "missing" ? "nicht vorhanden" : "nicht lesbar"}: es wird nichts zurückgesetzt (Verwaltung → Backups → Schlüssel).`);
    return [];
  }
  const issue = await secretKeyIssue();
  const stale = issue?.kind === "mismatch";
  if (stale && !options.force && !readApplied(options.dataRoot)) {
    console.error("[secrets] secret.key passt nicht zur Datenbank, eine Wiederherstellung mit dem Wiederherstellungsschlüssel ist möglich: es wird nichts zurückgesetzt (Seite „Schlüssel wiederherstellen“ bzw. Verwaltung → Backups → Schlüssel).");
    return [];
  }
  const { rows: affected, failed } = await collectAffected(stale, consumers);
  if (!affected) return [];
  const backup = writeResetBackup(affected, options.force ? "forced" : stale ? "restore" : "unreadable", options.dataRoot);

  const items: SecretResetItem[] = [];
  for (const consumer of consumers) {
    // Ohne Sicherung der Zeilen setzt ein Verbraucher nichts zurück (die Sicherung ging dem Zurücksetzen voraus)
    if (failed.has(consumer.id)) continue;
    try {
      const count = await consumer.resetUnreadable();
      if (count > 0) items.push({ id: consumer.id, count });
    } catch (error) {
      logError(`secrets:reset:${consumer.id}`, error);
    }
  }
  const keyDropped = await dropStaleRecoveryKey(db).catch((error) => (logError("secrets:dropKey", error), false));
  if (items.length === 0 && !keyDropped) return items;
  // Auf ausdrückliche Anweisung (`force`) schreibt die auslösende Operation den Audit-Eintrag (`secrets.resetForced`, mit der handelnden Person)
  if (!options.force) {
    await audit("secrets.reset", {
      actor: { id: null, name: "System" },
      target: [...items.map((i) => `${i.id}: ${i.count}`), ...(keyDropped ? ["Wiederherstellungsschlüssel veraltet"] : []), `Sicherung secret-reset/${backup}`].join(" · "),
    });
  }
  const previous = await readResetNotice();
  const merged = new Map<string, number>((previous?.items ?? []).map((i) => [i.id, i.count]));
  for (const item of items) merged.set(item.id, (merged.get(item.id) ?? 0) + item.count);
  const notice: SecretResetNotice = { at: new Date().toISOString(), items: [...merged].map(([id, count]) => ({ id, count })), keyDropped: keyDropped || !!previous?.keyDropped, backup };
  await setSetting(NOTICE_KEY, JSON.stringify(notice));
  return items;
}

/**
 * Ausdrücklicher Neuanfang durch die Administration: fehlt `secret.key` ganz (und gibt es keinen Weg zurück), wird ein neuer Schlüssel angelegt; danach werden alle
 * nicht lesbaren Geheimnisse – mit vorheriger Sicherung der Zeilen – zurückgesetzt. Ein nicht lesbarer (vorhandener) Schlüssel wird nie überschrieben.
 */
export async function resetSecretsByAdministrator(): Promise<{ items: SecretResetItem[]; newKey: boolean; backup: string | null }> {
  let state = readSecretKey();
  let newKey = false;
  if (state.state === "missing") {
    createSecretKey();
    newKey = true;
    state = readSecretKey();
  }
  if (state.state !== "readable") throw new SecretKeyUnavailableError(state.state, state.state === "unreadable" ? state.reason : undefined);
  const items = await resetUnreadableSecrets(undefined, { force: true });
  return { items, newKey, backup: items.length > 0 ? ((await readResetNotice())?.backup ?? null) : null };
}

/** Der offene Hinweis „nach der Wiederherstellung wurden Geheimnisse zurückgesetzt“ (null: keiner). */
export async function readResetNotice(client: Pick<typeof db, "appSetting"> = db): Promise<SecretResetNotice | null> {
  const raw = (await client.appSetting.findUnique({ where: { key: NOTICE_KEY } }))?.value ?? null;
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SecretResetNotice>;
    if (typeof value.at !== "string" || !Array.isArray(value.items)) return null;
    return {
      at: value.at,
      items: value.items.filter((i): i is SecretResetItem => !!i && typeof i.id === "string" && typeof i.count === "number"),
      keyDropped: value.keyDropped === true,
      ...(typeof value.backup === "string" ? { backup: value.backup } : {}),
    };
  } catch {
    return null;
  }
}

/** Hinweis als gesehen markieren (Administrator). */
export async function acknowledgeResetNotice(client: Pick<typeof db, "appSetting">): Promise<void> {
  await client.appSetting.deleteMany({ where: { key: NOTICE_KEY } });
}
