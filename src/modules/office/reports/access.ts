import type { Permission } from "@/modules/catalog";

/**
 * Wer welchen Bericht sehen darf – **an einer Stelle** für Übersicht, Seiten, CSV-Export, Widget und API: Ein Bericht braucht `reports.view` **und** das Leserecht der Quelle (ein Bericht zeigt nie,
 * was die Person an der Quelle nicht sehen dürfte). Die Fälligkeiten setzen sich aus mehreren Quellen zusammen: Sie sind sichtbar, sobald **eine** Quelle sichtbar ist, und jeder Teil zeigt nur, was
 * sein eigenes Recht zulässt.
 */
export const REPORT_IDS = ["revenue", "openItems", "utilization", "storage", "due"] as const;
export type ReportId = (typeof REPORT_IDS)[number];

/** Adresse der Seite je Bericht. */
export const REPORT_HREF: Record<ReportId, string> = { revenue: "/reports/revenue", openItems: "/reports/open-items", utilization: "/reports/utilization", storage: "/reports/storage", due: "/reports/due" };

/** Quellrechte je Bericht: Die Person braucht **eines** davon (Fälligkeiten) bzw. das eine (alle anderen). */
export const SOURCE_RIGHTS: Record<ReportId, readonly Permission[]> = {
  revenue: ["invoices.view"],
  openItems: ["invoices.view"],
  utilization: ["appointments.view"],
  storage: ["tires.view"],
  due: ["vehicles.view", "fleet.view", "invoices.view"],
};

type Can = { can: (permission: Permission) => boolean };

/** Darf die Person diesen Bericht öffnen? */
export const canOpenReport = (viewer: Can, id: ReportId): boolean => viewer.can("reports.view") && SOURCE_RIGHTS[id].some((permission) => viewer.can(permission));

/** Die Berichte, die diese Person öffnen darf, in der festen Reihenfolge. */
export const openableReports = (viewer: Can): ReportId[] => REPORT_IDS.filter((id) => canOpenReport(viewer, id));

export const isReportId = (value: unknown): value is ReportId => typeof value === "string" && (REPORT_IDS as readonly string[]).includes(value);
