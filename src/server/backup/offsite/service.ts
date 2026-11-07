import "server-only";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import * as tar from "tar";
import { createEncryptStream } from "@/lib/offsite/crypto";
import { backupNameOf, OFFSITE_NAME, offsiteFileName, planDeletions, planUploads, type RemoteEntry } from "@/lib/offsite/target";
import { getSetting, setSetting } from "@/server/settings";
import { backupPath, backupsDir, listBackups, markTempActive } from "../core";
import { BACKUP_ARCHIVE_LIMITS, decryptToFile, importBackupFile } from "../restore";
import { getOffsiteMasterKey } from "@/server/recovery-key";
import { getOffsiteCredentials, getOffsiteSettings, getUploadedNames, isConfigured, saveUploadedNames, type OffsiteCredentials, type OffsiteSettings } from "./settings";
import { OffsiteError, type OffsiteTransport } from "./transport";
import { pinnedFetch, resolvePinned } from "./resolve";
import { SftpTransport } from "./sftp";
import { WebdavTransport } from "./webdav";

/**
 * Off-Site-Backup: Sicherungen (Arten `auto` und `manual`) streamend als Archiv packen, mit dem Hauptschlüssel aus dem Wiederherstellungsschlüssel verschlüsseln
 * (`lib/offsite/crypto.ts`, `.sobk`) und per SFTP oder WebDAV ablegen; nie komplett im Speicher, nie unverschlüsselt am Ziel. Aufbewahrung am Ziel: die neuesten `keep`
 * eigenen Dateien bleiben, **nur Dateien mit dem eigenen Namensmuster** werden je gelöscht. Wiederholung und Fehleranzeige übernimmt der Job-Runner (Job `backup.offsite`).
 */
export type TransportFactory = (settings: OffsiteSettings, credentials: OffsiteCredentials) => Promise<OffsiteTransport>;

const defaultFactory: TransportFactory = async (settings, credentials) => {
  if (settings.protocol === "webdav") {
    if (!credentials.password) throw new OffsiteError("config", "Passwort");
    // Name auflösen, jede Antwort prüfen und nur mit der geprüften Adresse verbinden (ZP5-6)
    const pin = await resolvePinned(new URL(settings.url).hostname);
    return new WebdavTransport(settings.url, { username: settings.username, password: credentials.password }, { fetchImpl: pinnedFetch(pin) });
  }
  return SftpTransport.connect({ host: settings.host, port: settings.port, username: settings.username, path: settings.path, hostKey: settings.hostKey, credentials });
};

let factory: TransportFactory = defaultFactory;
/** Nur für Tests: Umsetzung des Ziels austauschen (Speicher statt Netzwerk). Ohne Argument: zurück zur echten. */
export function setTransportFactoryForTest(next?: TransportFactory): void {
  factory = next ?? defaultFactory;
}

const CHECKED_AT = "offsite.checkedAt";
const DAY_MS = 86_400_000;

type Prepared = { settings: OffsiteSettings; credentials: OffsiteCredentials; masterKey: Buffer };

/** Einstellungen, Zugangsdaten und Schlüssel; wirft `config`, wenn etwas fehlt. */
async function prepare(options: { requireEnabled: boolean }): Promise<Prepared | null> {
  const settings = await getOffsiteSettings();
  if (options.requireEnabled && !settings.enabled) return null;
  if (!isConfigured(settings)) throw new OffsiteError("config", "Ziel nicht eingerichtet");
  const [credentials, masterKey] = await Promise.all([getOffsiteCredentials(), getOffsiteMasterKey()]);
  if (!credentials || !(credentials.password || credentials.privateKey)) throw new OffsiteError("config", "Zugangsdaten fehlen");
  if (!masterKey) throw new OffsiteError("config", "Wiederherstellungsschlüssel fehlt");
  return { settings, credentials, masterKey };
}

/** Billige Vorabprüfung für den Job (nur Lesezugriffe): ist etwas hochzuladen, oder ist die tägliche Abstimmung mit dem Ziel fällig? */
export async function offsiteWorkPending(now = new Date()): Promise<boolean> {
  const settings = await getOffsiteSettings();
  if (!settings.enabled || !isConfigured(settings)) return false;
  const checked = Number(await getSetting(CHECKED_AT));
  if (!Number.isFinite(checked) || now.getTime() - checked > DAY_MS) return true;
  return planUploads(await listBackups(), await getUploadedNames(), settings.keep).length > 0;
}

export type OffsiteRunResult = { uploaded: string[]; deleted: string[]; deleteFailed: number; remoteCount: number };

/**
 * Ein Durchlauf: Ziel auflisten, fehlende Sicherungen hochladen (neueste zuerst), prüfen, dass sie am Ziel liegen, Aufbewahrung anwenden. Scheitert etwas, wirft die Funktion
 * (`OffsiteError`) – der Runner wiederholt mit wachsender Wartezeit. Fehlgeschlagene Löschungen sind kein Fehler des Laufs (`deleteFailed`). Gibt null zurück, wenn Off-Site aus ist.
 */
export async function runOffsite(options: { now?: Date; signal?: AbortSignal } = {}): Promise<OffsiteRunResult | null> {
  const prepared = await prepare({ requireEnabled: true });
  if (!prepared) return null;
  const { settings, credentials, masterKey } = prepared;
  const now = options.now ?? new Date();
  const transport = await factory(settings, credentials);
  try {
    const remote = await transport.list();
    const have = new Set(remote.filter((e) => OFFSITE_NAME.test(e.name)).map((e) => backupNameOf(e.name)));
    const uploaded: string[] = [];
    for (const name of planUploads(await listBackups(), have, settings.keep)) {
      if (options.signal?.aborted) throw new OffsiteError("timeout", "abgebrochen");
      const dir = backupPath(name);
      if (!dir) continue;
      await transport.put(offsiteFileName(name), encryptedArchive(dir, masterKey), options.signal);
      uploaded.push(name);
    }
    const after = uploaded.length ? await transport.list() : remote;
    for (const name of uploaded) if (!after.some((e) => e.name === offsiteFileName(name))) throw new OffsiteError("server", `${name} fehlt nach dem Hochladen`);

    let deleted: string[] = [];
    let deleteFailed = 0;
    for (const file of planDeletions(after, settings.keep, now)) {
      try {
        await transport.remove(file);
        deleted.push(file);
      } catch {
        deleteFailed++;
      }
    }
    deleted = deleted.map(backupNameOf);
    const remaining = after.filter((e) => OFFSITE_NAME.test(e.name) && !deleted.includes(backupNameOf(e.name)));
    await saveUploadedNames(new Set(remaining.map((e) => backupNameOf(e.name))));
    await setSetting(CHECKED_AT, String(now.getTime()));
    return { uploaded, deleted, deleteFailed, remoteCount: remaining.length };
  } finally {
    await transport.close().catch(() => undefined);
  }
}

/** Das Archiv einer Sicherung (wie der Download) als verschlüsselter Strom. Fehler beim Packen erreichen den Empfänger. */
function encryptedArchive(dir: string, masterKey: Buffer): Readable {
  const pack = tar.c({ cwd: dir, portable: true }, ["."]);
  const source = Readable.from(pack);
  const encrypted = createEncryptStream(masterKey);
  pack.on("error", (error: unknown) => encrypted.destroy(error as Error));
  source.once("error", (error) => encrypted.destroy(error));
  // Bricht der Empfänger ab, werden Strom und Archivierer geschlossen (sonst blieben Dateien der Sicherung geöffnet)
  encrypted.once("close", () => {
    source.destroy();
    pack.destroy();
  });
  return source.pipe(encrypted);
}

/** „Verbindung testen“: mit den gespeicherten Einstellungen verbinden und das Verzeichnis auflisten. Ändert nichts (legt höchstens das Verzeichnis an). */
export async function testOffsite(): Promise<{ files: number }> {
  const prepared = await prepare({ requireEnabled: false });
  const transport = await factory(prepared!.settings, prepared!.credentials);
  try {
    return { files: (await transport.list()).filter((e) => OFFSITE_NAME.test(e.name)).length };
  } finally {
    await transport.close().catch(() => undefined);
  }
}

export type RemoteBackup = { file: string; name: string; size: number; modifiedAt: Date | null };

/** Eigene Sicherungen am Ziel, neueste zuerst. */
export async function listOffsiteBackups(): Promise<RemoteBackup[]> {
  const prepared = await prepare({ requireEnabled: false });
  const transport = await factory(prepared!.settings, prepared!.credentials);
  try {
    return (await transport.list())
      .filter((e: RemoteEntry) => OFFSITE_NAME.test(e.name))
      .map((e) => ({ file: e.name, name: backupNameOf(e.name), size: e.size, modifiedAt: e.modifiedAt }))
      .sort((a, b) => (a.name < b.name ? 1 : -1));
  } finally {
    await transport.close().catch(() => undefined);
  }
}

/**
 * Rückweg: eine Sicherung vom Ziel holen, entschlüsseln und als hochgeladenes Backup (`upload`) in die lokale Liste übernehmen – von dort lässt sie sich wie jede andere
 * wiederherstellen. Gestreamt; die entschlüsselte Zwischendatei wird nach dem Import gelöscht. Fehler: `OffsiteError` (Ziel) oder `RestoreError` (Datei).
 */
export async function fetchOffsiteBackup(file: string, signal?: AbortSignal): Promise<string> {
  if (!OFFSITE_NAME.test(file)) throw new OffsiteError("config", "Dateiname");
  const prepared = await prepare({ requireEnabled: false });
  const { settings, credentials, masterKey } = prepared!;
  const root = backupsDir();
  mkdirSync(root, { recursive: true });
  const plain = path.join(root, `.upload-${randomBytes(6).toString("hex")}`);
  const release = markTempActive(plain);
  const transport = await factory(settings, credentials);
  try {
    const input = await transport.get(file, signal);
    await decryptToFile(input, plain, masterKey, root, BACKUP_ARCHIVE_LIMITS.maxBytes);
    return await importBackupFile(plain);
  } finally {
    await transport.close().catch(() => undefined);
    rmSync(plain, { force: true });
    release();
  }
}
