import type { JobDef } from "@/server/jobs/types";
import { purgeRemovedFiles } from "./purge";

/** Entfernte Dateien nach einer Frist endgültig vom Datenträger lösen (täglich nachts; scheitert der Lauf, wiederholt der Runner mit Wartezeit). */
export const jobs: JobDef[] = [
  {
    id: "files.purge",
    feature: "workshop.files",
    schedule: { cron: "30 3 * * *" },
    run: async ({ now }) => `${await purgeRemovedFiles(now)} gelöscht`,
  },
];
