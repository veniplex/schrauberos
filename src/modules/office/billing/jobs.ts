import type { JobDef } from "@/server/jobs/types";
import { purgeSentFiles } from "./sent-files";
import { purgeOrphanOriginals, purgeOriginals } from "./original-files";

/**
 * **Beide Läufe sind `always`** (laufen auch bei ausgeschalteter Rechnungserstellung): Der Storno-Hook (`invoices.cancel`) und der Anonymisierungs-Hook (`customers.anonymize`) laufen ebenfalls auch bei ausgeschalteter
 * Funktion und legen Originale an bzw. geben Dateien frei – das Aufräumen darf dann nicht bis zum Wiedereinschalten liegen bleiben (sonst hielten freigegebene Dateien mit Namen und Anschrift eines anonymisierten
 * Kunden unbegrenzt). Sie arbeiten nur an Zeilen, die es gibt; bei leerem Bestand tun sie nichts.
 */
/** Versendete Anhänge aufräumen (täglich nachts): Angebote und Auftragsbestätigungen nach 30 Tagen, anonymisierte Kunden sofort. Scheitert der Lauf, wiederholt der Runner mit Wartezeit. */
export const jobs: JobDef[] = [
  {
    id: "billing.sent-files",
    feature: "office.billing",
    always: true,
    schedule: { cron: "50 3 * * *" },
    run: async ({ now }) => `${await purgeSentFiles(now)} gelöscht`,
  },
  {
    // Originale festgeschriebener Rechnungen: nur lösen, was die Anonymisierung freigegeben hat (`purgeAfter`), und verwaiste Dateien nach einem zurückgerollten Festschreiben (ohne Zeile, älter als eine Stunde)
    id: "billing.originals",
    feature: "office.billing",
    always: true,
    schedule: { cron: "55 3 * * *" },
    run: async ({ now }) => {
      const purged = await purgeOriginals(now);
      const orphans = await purgeOrphanOriginals(now);
      return purged + orphans > 0 ? `${purged} gelöscht, ${orphans} verwaiste Dateien entfernt` : undefined;
    },
  },
];
