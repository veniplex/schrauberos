import type { MessageKey } from "@/i18n/translate";
import { dayKey, workshopZone } from "./zone";

/**
 * Datenschutz (P4b-5), rein: die Bausteine der Auskunft (Art. 15 DSGVO) und die Aufbewahrungsfrist, nach der ein Kunde anonymisiert werden darf. Die Funktionen liefern ihre Daten über
 * Anbieter (`PrivacyProviderDef`, `src/modules/types.ts`); hier steht nur, was keine Funktion kennt.
 *
 * **Aufbewahrungsfrist:** Sie beginnt mit dem Ablauf des Kalenderjahres, in dem die Rechnung ausgestellt wurde, und dauert N Jahre – eine Rechnung vom 14.03.2026 mit 8 Jahren Frist
 * ist bis zum **31.12.2034** aufzubewahren und erst danach (ab 01.01.2035) freigegeben. Das Jahr zählt in der Zeitzone der Werkstatt. Die Jahre sind einstellbar, die Standardwerte (8 und
 * 10) sind Platzhalter, bis ein Administrator sie bestätigt hat.
 */

export type PrivacyValue = string | number | boolean | null;
export type PrivacyField = { key: string; label: MessageKey; value: PrivacyValue };
/** Ein Datensatz der Auskunft (z. B. ein Fahrzeug): benannte Felder in fester Reihenfolge. */
export type PrivacyRecord = PrivacyField[];
export type PrivacySection = { id: string; title: MessageKey; records: PrivacyRecord[] };

/** Um wen es geht: die Kennung des Kunden und Suchbegriffe, unter denen er in Freitexten vorkommen kann (Name, Firma, Kundennummer, E-Mail) – für die Fundstellen in der Dokumentation. */
export type PrivacySubject = { id: string; terms: string[] };

export const field = (key: string, label: MessageKey, value: PrivacyValue | Date | undefined): PrivacyField => ({
  key,
  label,
  value: value === undefined ? null : value instanceof Date ? value.toISOString() : value,
});

/** Zeitpunkt als Kalendertag der Werkstatt (`JJJJ-MM-TT`) für die Auskunft; leer bleibt leer. */
export const dayField = (key: string, label: MessageKey, value: Date | null | undefined): PrivacyField => ({ key, label, value: value ? dayKey(value) : null });

/* ───────────── Aufbewahrungsfrist ───────────── */

export type RetentionKind = "invoice" | "finalizedInvoice";
export type RetentionItem = { date: Date; kind: RetentionKind };
export type RetentionRules = { invoiceYears: number; booksYears: number };

/** Letzter Tag der Aufbewahrung (`JJJJ-12-31`): Ende des Kalenderjahres der Rechnung plus die Frist in Jahren. */
export function retentionEndKey(date: Date, years: number, timeZone: string = workshopZone()): string {
  const year = Number(dayKey(date, timeZone).slice(0, 4));
  return `${year + years}-12-31`;
}

/** Spätestes Ende der Fristen über alle Belege (`null`, wenn es keine gibt). */
export function retentionEnd(items: readonly RetentionItem[], rules: RetentionRules, timeZone: string = workshopZone()): string | null {
  let latest: string | null = null;
  for (const item of items) {
    const end = retentionEndKey(item.date, item.kind === "finalizedInvoice" ? rules.booksYears : rules.invoiceYears, timeZone);
    if (latest === null || end > latest) latest = end;
  }
  return latest;
}

export type AnonymizeBlock =
  /** schon anonymisiert */
  | { reason: "already" }
  /** die Fristen sind noch nicht von einem Administrator bestätigt */
  | { reason: "unconfirmed" }
  /** mindestens ein Beleg ist noch aufzubewahren, bis einschließlich `until` */
  | { reason: "running"; until: string };

/** Darf der Kunde jetzt anonymisiert werden? `null` = ja. Heute zählt als Kalendertag der Werkstatt; am Fristende selbst ist noch gesperrt. */
export function anonymizeBlock(input: { anonymizedAt: Date | null; confirmed: boolean; items: readonly RetentionItem[]; rules: RetentionRules; now?: Date; timeZone?: string }): AnonymizeBlock | null {
  const timeZone = input.timeZone ?? workshopZone();
  if (input.anonymizedAt) return { reason: "already" };
  if (!input.confirmed) return { reason: "unconfirmed" };
  const until = retentionEnd(input.items, input.rules, timeZone);
  if (until !== null && dayKey(input.now ?? new Date(), timeZone) <= until) return { reason: "running", until };
  return null;
}

/* ───────────── Auskunft als Tabelle ───────────── */

/** Die Auskunft als flache Tabelle für CSV: je Wert eine Zeile *Bereich · Nr. · Feld · Wert* (alles in einer Datei, Freitexte inklusive). */
export function disclosureRows(sections: readonly PrivacySection[], t: (key: MessageKey) => string): Array<[string, string, string, string]> {
  const rows: Array<[string, string, string, string]> = [];
  for (const section of sections) {
    section.records.forEach((record, index) => {
      for (const f of record) rows.push([t(section.title), String(index + 1), t(f.label), f.value === null ? "" : String(f.value)]);
    });
  }
  return rows;
}
