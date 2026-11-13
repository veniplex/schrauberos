import type { JobDef } from "@/server/jobs/types";
import { purgeSentFiles } from "./sent-files";
import { purgeOrphanOriginals, purgeOriginals } from "./original-files";

/** Versendete Anhänge aufräumen (täglich nachts): Angebote und Auftragsbestätigungen nach 30 Tagen, anonymisierte Kunden sofort. Scheitert der Lauf, wiederholt der Runner mit Wartezeit. */
export const jobs: JobDef[] = [
  {
    id: "billing.sent-files",
    feature: "office.billing",
    schedule: { cron: "50 3 * * *" },
    run: async ({ now }) => `${await purgeSentFiles(now)} gelöscht`,
  },
  {
    // Originale festgeschriebener Rechnungen: nur lösen, was die Anonymisierung freigegeben hat (`purgeAfter`), und verwaiste Dateien nach einem zurückgerollten Festschreiben (ohne Zeile, älter als eine Stunde)
    id: "billing.originals",
    feature: "office.billing",
    schedule: { cron: "55 3 * * *" },
    run: async ({ now }) => {
      const purged = await purgeOriginals(now);
      const orphans = await purgeOrphanOriginals(now);
      return purged + orphans > 0 ? `${purged} gelöscht, ${orphans} verwaiste Dateien entfernt` : undefined;
    },
  },
];
