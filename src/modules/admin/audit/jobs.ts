import { pruneAuditLog } from "@/server/audit-retention";
import type { JobDef } from "@/server/jobs/types";

/** Aufbewahrung des Audit-Logs: täglich nachts; scheitert der Lauf (gesperrte Datenbank …), wiederholt der Runner mit Wartezeit statt erst am nächsten Tag. */
export const jobs: JobDef[] = [
  {
    id: "audit.retention",
    feature: "admin.audit",
    schedule: { cron: "0 3 * * *" },
    run: async ({ now }) => `${await pruneAuditLog(now)} gelöscht`,
  },
];
