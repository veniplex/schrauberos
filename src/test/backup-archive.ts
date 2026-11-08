import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { backupPath, DB_ARCHIVE } from "@/server/backup/core";

/** Inhalt der Datei `database.db.gz` einer Sicherung als Roh-Datenbank – nur für Tests (im Betrieb entpackt nie etwas ohne Größengrenze, `gunzipDatabase` mit `limitStream`). */
export const readDatabaseArchive = (name: string): Buffer => gunzipSync(readFileSync(path.join(backupPath(name)!, DB_ARCHIVE)));
