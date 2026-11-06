import "server-only";
import { audit } from "@/server/audit";
import { cleanupBackupTemp, createBackup, listBackups, pruneBackups } from "./core";
import { getBackupSettings } from "./settings";

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Legt eine automatische Sicherung an, wenn die Uhrzeit erreicht und heute noch keine erstellt wurde (Job `backup.auto`, prüft alle 10 Minuten; „heute“ ist der
 * Kalendertag der Werkstatt-Zeitzone, die die App als Prozess-Zeitzone setzt). Danach gilt die Aufbewahrung. Scheitert das Anlegen, wirft die Funktion: Der Runner
 * wiederholt mit wachsender Wartezeit und zeigt den Fehler an. Liefert den Namen der neuen Sicherung oder null.
 */
export async function runAutoBackup(now = new Date()): Promise<string | null> {
  const settings = await getBackupSettings();
  if (!settings.enabled || now.getHours() < settings.hour) return null;
  if (listBackups().some((b) => b.kind === "auto" && sameDay(b.createdAt, now))) return null;
  const info = await createBackup("auto");
  pruneBackups(settings.retention, now);
  await audit("backup.create", { actor: { id: null, name: "System" }, target: info.name });
  return info.name;
}

/** Aufbewahrung je Art anwenden und liegengebliebene Zwischenordner abgebrochener Backups entfernen (Job `backup.retention`, täglich). Liefert die Zahl gelöschter Backups. */
export async function runBackupRetention(now = new Date()): Promise<number> {
  cleanupBackupTemp();
  const removed = pruneBackups((await getBackupSettings()).retention, now);
  return removed.length;
}
