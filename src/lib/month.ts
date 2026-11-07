/**
 * Kalendermonate als Text „JJJJ-MM“ (Prüffristen, Monatsfilter) – rein, ohne Uhr. Die Zeichenfolgen lassen sich direkt vergleichen und sortieren
 * (`"2026-09" < "2026-11"`), in der Datenbank genügt deshalb eine Textspalte.
 */

/** „JJJJ-MM“ mit Monat 01–12 */
export const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const isMonth = (value: string): boolean => {
  const m = MONTH_PATTERN.exec(value);
  return !!m && Number(m[1]) >= 1950 && Number(m[1]) <= 2100;
};

/** Monat einer Zeit als „JJJJ-MM“ (Ortszeit, wie das Datum der Anwendung). */
export const monthOf = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

/** Monat plus `n` Monate (auch negativ) als „JJJJ-MM“. */
export function addMonths(month: string, n: number): string {
  const m = MONTH_PATTERN.exec(month);
  if (!m) throw new Error(`Kein Monat: ${month}`);
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Wie viele Monate liegt `to` hinter `from`? (negativ = davor) */
export function monthsBetween(from: string, to: string): number {
  const a = MONTH_PATTERN.exec(from);
  const b = MONTH_PATTERN.exec(to);
  if (!a || !b) throw new Error("Kein Monat");
  return (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
}

/**
 * Monatseingabe in der Schreibweise des Anwenders → „JJJJ-MM“: `2026-11` (Monatsfeld des Browsers), `11/2026`, `11.2026`, `1.2026`, `11-2026`. Alles andere (auch ein nicht vorhandener Monat) → `null`.
 * Browser ohne Monatsfeld (Firefox am Computer) zeigen ein Textfeld, in dem man „11/2026“ tippt.
 */
export function parseMonthInput(text: string): string | null {
  const value = text.trim();
  if (isMonth(value)) return value;
  const m = /^(\d{1,2})\s*[./-]\s*(\d{4})$/.exec(value);
  if (!m) return null;
  const month = `${m[2]}-${m[1].padStart(2, "0")}`;
  return isMonth(month) ? month : null;
}

/** Erster Tag des Monats (Ortszeit, 12 Uhr – ohne Zeitzonen-Sprünge) zum Formatieren mit `Intl` („November 2026“). */
export function monthStart(month: string): Date {
  const m = MONTH_PATTERN.exec(month);
  if (!m) throw new Error(`Kein Monat: ${month}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, 1, 12);
}
