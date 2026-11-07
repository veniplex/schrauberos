import "server-only";
import { phoneTerm, searchTerms } from "@/lib/search-key";
import type { Permission } from "@/modules/catalog";

/**
 * Teilstring-Suche (SQL LIKE). SQLite unterscheidet dabei bei ASCII-Buchstaben nicht zwischen Groß- und Kleinschreibung;
 * bei Umlauten schon („MÜLLER“ findet „Müller“ nicht, „müller“ schon). Zentral gekapselt, damit sich das an einer Stelle
 * verbessern lässt (z. B. über normalisierte Suchspalten).
 *
 * **LIKE-Platzhalter:** Prisma maskiert `%` und `_` im Suchtext unter SQLite nicht (`%%` und `__` träfen jede Zeile, `a_b` auch „axb“; per Test belegt). Eine Maskierung
 * (`ESCAPE`) gibt es über Prisma nicht; deshalb: `%` entfällt aus dem Suchtext, `_` bleibt (trifft höchstens mehr, nie weniger als gemeint), und ein Suchtext aus nichts als
 * Platzhaltern findet **nichts** statt alles.
 */
export function contains(value: string): { contains: string } | { in: string[] } {
  const term = value.replace(/%/g, "");
  if (term.replace(/_/g, "").length === 0) return { in: [] };
  return { contains: term };
}

type KeyCondition<K extends string> = { [P in K]: { contains: string } | { in: string[] } };

/**
 * Suche in einer **normalisierten Suchspalte** (`src/lib/search-key.ts`: klein, ohne Akzente, Umlaut-Schreibungen, Trenner als Leerzeichen; P2b-1): Jedes Wort des Suchtextes muss
 * in der Spalte vorkommen, die Reihenfolge ist egal („müller hans“ findet „Hans Müller“). Ein Suchtext ohne Wort (nur Trenner) findet nichts.
 * Die Platzhalter `%`/`_` sind dabei schon Trenner, eine Maskierung entfällt.
 */
export function keyContains<K extends string>(column: K, term: string): { AND: Array<KeyCondition<K>> } {
  const words = searchTerms(term);
  if (words.length === 0) return { AND: [{ [column]: { in: [] } } as unknown as KeyCondition<K>] };
  return { AND: words.map((word) => ({ [column]: { contains: word } }) as KeyCondition<K>) };
}

/** Suche in einer Telefonspalte (`phoneKey`, nur Ziffern): Der Suchtext zählt erst ab drei Ziffern und ohne Buchstaben als Nummer, sonst trifft er hier nichts. */
export function phoneContains<K extends string>(column: K, term: string): KeyCondition<K> {
  const key = phoneTerm(term);
  return { [column]: key ? { contains: key } : { in: [] } } as KeyCondition<K>;
}

/** Ab dieser Länge des Suchtextes werden lange Textfelder (Inhalt von Dokumentationsseiten, Termin-Notizen) durchsucht: kürzere Begriffe träfen fast alles und kosten bei jedem Tastendruck einen Durchlauf über den ganzen Text. */
export const FULLTEXT_MIN_LENGTH = 3;

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
