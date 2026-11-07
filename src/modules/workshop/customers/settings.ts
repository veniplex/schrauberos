import "server-only";
import { cache } from "react";
import type { RetentionRules } from "@/lib/privacy";
import { db } from "@/server/db";

/** Datenschutz-Einstellungen (Singleton-Zeile, beim ersten Zugriff mit den Platzhalter-Standardwerten angelegt): Aufbewahrungsfristen und ihre Bestätigung durch einen Administrator. */
export type PrivacyConfig = { rules: RetentionRules; confirmedAt: Date | null; confirmedByName: string | null };

export const getPrivacyConfig = cache(async (): Promise<PrivacyConfig> => {
  const row = await db.privacySettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  return { rules: { invoiceYears: row.retentionInvoiceYears, booksYears: row.retentionBooksYears }, confirmedAt: row.retentionConfirmedAt, confirmedByName: row.retentionConfirmedByName };
});
