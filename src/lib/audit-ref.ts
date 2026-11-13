/**
 * Wie Audit-Einträge Personen nennen: **nie mit Namen**. Das Audit-Log wird nie verändert (auch nicht bei der Anonymisierung eines Kunden) und lebt bis zur Audit-Aufbewahrungsfrist
 * (Einstellung, Standard 730 Tage, `0` = dauerhaft); ein Name im Eintrag bliebe also so lange stehen. Neue Einträge nennen deshalb nur Art und Kennung: die Kunden-/Personalnummer, sonst das Ende
 * der technischen Kennung. Die Kennung der Sache steht zusätzlich in `entityId`. Bestehende Zeilen bleiben unverändert.
 */
export const personRef = (kind: "Kunde" | "Mitarbeiter", person: { id: string; number?: string | null }): string => `${kind} ${person.number?.trim() || person.id.slice(-8)}`;
