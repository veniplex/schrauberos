import type { JobDef } from "@/server/jobs/types";
import { purgeSentFiles } from "./sent-files";

/** Versendete Anhänge aufräumen (täglich nachts): Angebote und Auftragsbestätigungen nach 30 Tagen, anonymisierte Kunden sofort. Scheitert der Lauf, wiederholt der Runner mit Wartezeit. */
export const jobs: JobDef[] = [
  {
    id: "billing.sentFiles",
    feature: "office.billing",
    schedule: { cron: "50 3 * * *" },
    run: async ({ now }) => `${await purgeSentFiles(now)} gelöscht`,
  },
];
