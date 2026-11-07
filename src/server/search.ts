import "server-only";
import type { Permission } from "@/modules/catalog";

/**
 * Teilstring-Suche (SQL LIKE). SQLite unterscheidet dabei bei ASCII-Buchstaben nicht zwischen Groß- und Kleinschreibung;
 * bei Umlauten schon („MÜLLER“ findet „Müller“ nicht, „müller“ schon). Zentral gekapselt, damit sich das an einer Stelle
 * verbessern lässt (z. B. über normalisierte Suchspalten).
 */
export function contains(value: string) {
  return { contains: value };
}

/** Ein durchsuchbares Feld einer Liste. `permission`: nur wer dieses Recht hat, darf darin suchen (sonst ließe die Trefferliste Rückschlüsse auf verborgene Daten zu). */
export type SearchField<W> = { permission?: Permission; where: (term: string) => W };

/**
 * „Wörterbuch pro Berechtigung“: die Suchbedingung einer Liste aus genau den Feldern, die der Aufrufer durchsuchen darf. Wer ein Feld nicht sehen darf
 * (Telefon des Kunden ohne `customers.view`, Kennzeichen ohne `vehicles.view` …), findet auch nichts darüber – ein Treffer wäre sonst eine Auskunft.
 * Liefert `null` bei leerem Suchbegriff (kein Filter). Ohne erlaubtes Feld ist die Bedingung unerfüllbar (`OR: []`), nicht „alles“.
 */
export function searchWhere<W>(term: string, can: (permission: Permission) => boolean, fields: ReadonlyArray<SearchField<W>>): { OR: W[] } | null {
  if (!term) return null;
  return { OR: fields.filter((f) => !f.permission || can(f.permission)).map((f) => f.where(term)) };
}
