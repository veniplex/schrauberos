/**
 * Archiv (P4b-2): Kunden und Fahrzeuge (`archivedAt`) sowie Arbeitsplätze und Terminarten (`active = false`) werden **archiviert statt gelöscht**, wenn etwas an ihnen hängt. Ein
 * archivierter Datensatz bleibt mit allen Verknüpfungen erhalten, verschwindet aber aus Auswahlfeldern, Suche, Schnellsuche und Neu-Formularen; die Listen zeigen ihn über den Filter
 * „Archiviert“, und er lässt sich wieder aktivieren. Dies sind die gemeinsamen Bausteine: der Listenfilter und die Abhängigkeitszählung.
 */
export const ARCHIVE_FILTERS = ["active", "archived", "all"] as const;
export type ArchiveFilter = (typeof ARCHIVE_FILTERS)[number];

/** Adresswert (`?archived=`) → Filter: Standard „active“ (nur nicht archivierte); `1`, `only` und `archived` zeigen nur Archivierte, `all` alle. */
export function parseArchiveFilter(value: string | null | undefined): ArchiveFilter {
  if (value === "all") return "all";
  if (value === "1" || value === "only" || value === "archived" || value === "true") return "archived";
  return "active";
}

/** Prisma-Bedingung auf `archivedAt` zum Filter. */
export function archivedWhere(filter: ArchiveFilter): { archivedAt?: null | { not: null } } {
  return filter === "active" ? { archivedAt: null } : filter === "archived" ? { archivedAt: { not: null } } : {};
}

/** Adressteil für Links, die den Filter weitergeben (`""` im Standard). */
export const archiveParam = (filter: ArchiveFilter): Record<string, string> => (filter === "active" ? {} : { archived: filter === "all" ? "all" : "1" });

/** Eine Abhängigkeit für die Anzeige vor dem Löschen/Archivieren: Art (Meldungsschlüssel unter `archive.deps.*`) und Anzahl; nur Zähler über 0 werden angezeigt. */
export type Dependency = { kind: string; count: number };

export const nonZero = (deps: readonly Dependency[]): Dependency[] => deps.filter((d) => d.count > 0);
