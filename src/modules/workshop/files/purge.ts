import "server-only";
import { db } from "@/server/db";
import { removeFile } from "@/server/files";

/**
 * Entfernte Dateien endgültig löschen (Löschlauf, `jobs.ts`): Eine Datei, die vor mehr als `PURGE_AFTER_DAYS` Tagen entfernt (archiviert) wurde, wird vom Datenträger gelöst. Das **löst nur den Verweis unter
 * `/data/files`**: Backups halten ihre Dateien per Hardlink und behalten sie bis zu ihrer eigenen Aufbewahrung (die Datei verschwindet erst mit dem letzten Verweis). Die Datenbankzeile bleibt als Nachweis
 * (Zeitpunkt, Größe, Art, Person) – ohne Dateiname und Beschriftung (`purgedAt` gesetzt). Bis dahin zählt eine entfernte Datei im Kontingent des Fahrzeugs bzw. Auftrags mit (sonst ließe sich der Datenträger
 * über Hochladen und Entfernen füllen) und lässt sich über die Datenbank und das Dateiverzeichnis wiederherstellen.
 *
 * Wiederholbar: erst die Datei lösen (fehlt sie schon, ist das in Ordnung), dann die Zeile markieren; ein Abbruch dazwischen holt der nächste Lauf nach. In Teilen (`BATCH`), damit ein Lauf kurz bleibt.
 */
export const PURGE_AFTER_DAYS = 30;
const BATCH = 200;

export async function purgeRemovedFiles(now: Date = new Date(), afterDays: number = PURGE_AFTER_DAYS): Promise<number> {
  const cutoff = new Date(now.getTime() - afterDays * 86_400_000);
  let purged = 0;
  for (;;) {
    const rows = await db.fileAttachment.findMany({ where: { purgedAt: null, archivedAt: { not: null, lt: cutoff } }, orderBy: { archivedAt: "asc" }, take: BATCH, select: { id: true, path: true, mime: true } });
    if (rows.length === 0) return purged;
    for (const row of rows) {
      await removeFile(row.path);
      await db.fileAttachment.update({ where: { id: row.id }, data: { purgedAt: now, caption: null, name: row.mime === "application/pdf" ? "gelöscht.pdf" : "gelöscht" } });
      purged++;
    }
    if (rows.length < BATCH) return purged;
  }
}
