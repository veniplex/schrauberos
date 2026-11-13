/**
 * Wie Audit-Einträge Personen nennen: **nie mit Namen**. Das Audit-Log wird nie verändert (auch nicht bei der Anonymisierung eines Kunden) und lebt bis zur Audit-Aufbewahrungsfrist
 * (Einstellung, Standard 730 Tage, `0` = dauerhaft); ein Name im Eintrag bliebe also so lange stehen. Neue Einträge nennen deshalb nur Art und Kennung: bei Kunden die Kundennummer, sonst das Ende
 * der technischen Kennung. **Mitarbeiter erscheinen immer nur mit dem Ende der Kennung, nie mit der Personalnummer** (Entscheid, Block 15): Sie ist ein freier, optionaler Text und kann Namen oder anderes
 * Persönliches enthalten – ins unveränderliche Audit-Log gehört kein Freitext. Die ganze Kennung der Sache steht zusätzlich in `entityId`; Name und Personalnummer lassen sich über die Mitarbeiterverwaltung nachschlagen. Bestehende Zeilen bleiben unverändert.
 */
export const personRef = (kind: "Kunde" | "Mitarbeiter", person: { id: string; number?: string | null }): string => `${kind} ${(kind === "Kunde" ? person.number?.trim() : undefined) || person.id.slice(-8)}`;
