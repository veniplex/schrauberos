/**
 * Grenzen des Datenaustauschs (CSV). Sie gelten für Import **und** Export und stehen an einer Stelle, damit Oberfläche, Route und Tests dieselben Zahlen nennen.
 *
 *  - `importBytes`: größte angenommene Datei. Das ist bewusst klein: Die Datei wird vollständig im Speicher verarbeitet (nie auf die Platte gelegt) und muss unter der
 *    10-MiB-Grenze des Proxys für Anfragen bleiben (`src/proxy.ts`).
 *  - `importRows`: höchstens so viele Datenzeilen (ohne Kopfzeile). Ein Import läuft in **einer** Transaktion (Zeitgrenze 20 s); 5000 Zeilen schafft er mit Reserve.
 *  - `columns`, `fieldChars`: Schutz vor Dateien, die nur auf Speicher und Zeit zielen (Millionen Spalten, ein Feld von Megabyte-Größe).
 *  - `exportRows`: größte Exportmenge; darüber meldet die Route „zu viele Zeilen“ (Filter einschränken), statt den Server minutenlang zu beschäftigen.
 */
export const CSV_LIMITS = {
  importBytes: 5 * 1024 * 1024,
  importRows: 5000,
  columns: 80,
  fieldChars: 10_000,
  exportRows: 100_000,
} as const;
