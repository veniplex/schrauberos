import "server-only";
import { logError } from "@/lib/log-safe";
import { audit } from "@/server/audit";
import { cleanupBackupTemp, createBackup, listBackups, pruneBackups } from "./core";
import { getBackupSettings } from "./settings";

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export type AutoBackupResult = { name: string; pruned: number; pruneFailed: boolean };

/**
 * Legt eine automatische Sicherung an, wenn die Uhrzeit erreicht und heute noch keine erstellt wurde (Job `backup.auto`, prüft alle 10 Minuten; „heute“ ist der
 * Kalendertag der Werkstatt-Zeitzone, die die App als Prozess-Zeitzone setzt). Mit `force` („Jetzt ausführen“) gelten Uhrzeit und „heute schon“ nicht (ausgeschaltet bleibt
 * ausgeschaltet). Scheitert das Anlegen, wirft die Funktion: Der Runner wiederholt mit wachsender Wartezeit und zeigt den Fehler an.
 *
 * Reihenfolge: Backup anlegen → **Audit** (`backup.create`) → Aufbewahrung. Scheitert die Aufbewahrung, ist das Backup trotzdem da und protokolliert; der Fehler wird
 * nur gemeldet (`pruneFailed`), er macht den Lauf nicht zum Fehlschlag (sonst „Anlegen fehlgeschlagen“ trotz vorhandenem Backup). Die tägliche Aufbewahrung
 * (`backup.retention`) versucht es erneut und zeigt den Fehler dort. Liefert das Ergebnis oder null (nichts zu tun).
 */
export async function runAutoBackup(now = new Date(), options: { force?: boolean; signal?: AbortSignal } = {}): Promise<AutoBackupResult | null> {
  const settings = await getBackupSettings();
  if (!settings.enabled) return null;
  if (!options.force) {
    if (now.getHours() < settings.hour) return null;
    if ((await listBackups()).some((b) => b.kind === "auto" && sameDay(b.createdAt, now))) return null;
  }
  const info = await createBackup("auto");
  // Das Backup ist da: scheitert nur das Protokollieren, bleibt der Lauf ein Erfolg (sonst käme beim Wiederholen ein zweites Backup)
  await audit("backup.create", { actor: { id: null, name: "System" }, target: info.name }).catch((error) => logError("backup:audit", error));
  if (options.signal?.aborted) return { name: info.name, pruned: 0, pruneFailed: false };
  try {
    return { name: info.name, pruned: (await pruneBackups(settings.retention, now)).length, pruneFailed: false };
  } catch (error) {
    logError("backup:prune", error);
    return { name: info.name, pruned: 0, pruneFailed: true };
  }
}

/** Aufbewahrung je Art anwenden und liegengebliebene Zwischenordner abgebrochener Backups entfernen (Job `backup.retention`, täglich). Liefert die Zahl gelöschter Backups. */
export async function runBackupRetention(now = new Date()): Promise<number> {
  await cleanupBackupTemp();
  return (await pruneBackups((await getBackupSettings()).retention, now)).length;
}
