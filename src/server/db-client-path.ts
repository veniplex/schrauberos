import path from "node:path";

/** Pfad der SQLite-Datei aus DATABASE_URL (`file:...`); relative Pfade gelten ab dem Arbeitsverzeichnis. Ohne Abhängigkeiten (auch vom Launcher genutzt). */
export function databaseFile(url = process.env.DATABASE_URL ?? "file:./dev.db"): string {
  if (!url.startsWith("file:")) throw new Error("DATABASE_URL muss auf eine SQLite-Datei zeigen (file:...).");
  return path.resolve(url.slice("file:".length));
}
