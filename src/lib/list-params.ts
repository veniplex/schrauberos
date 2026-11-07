/**
 * Gemeinsame Bausteine für Listen: Sortierung und Seite aus der Adresse lesen, Adressen für Sortierung und Seitenwahl bauen.
 * Alles aus der Adresse ist Eingabe des Benutzers: Sortierschlüssel werden gegen eine Liste erlaubter Werte geprüft, die Seite auf einen sinnvollen Bereich begrenzt.
 */
export type SortDir = "asc" | "desc";
export const DEFAULT_PAGE_SIZE = 25;
type Params = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export type ListParams = { sort: string; dir: SortDir; page: number; pageSize: number };

/** Liest `sort`, `dir` und `page`. Unbekannte Sortierschlüssel fallen auf den Standard zurück, ungültige Seiten auf 1. */
export function parseListParams(params: Params, options: { sorts: readonly string[]; sort: string; dir?: SortDir; pageSize?: number; dirParam?: string }): ListParams {
  const key = one(params.sort) ?? "";
  const known = options.sorts.includes(key);
  const dirRaw = one(params[options.dirParam ?? "dir"]);
  const page = Number.parseInt(one(params.page) ?? "1", 10);
  return {
    sort: known ? key : options.sort,
    dir: known && (dirRaw === "asc" || dirRaw === "desc") ? dirRaw : (options.dir ?? "asc"),
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 1_000_000) : 1,
    pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE,
  };
}

export const pageCount = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize));

/** Die Seite, die es gibt: hinter der letzten Seite (Filter geändert, Einträge gelöscht) gilt die letzte. */
export const clampPage = (page: number, total: number, pageSize: number) => Math.min(Math.max(1, page), pageCount(total, pageSize));

/** `skip`/`take` für Prisma. */
export const pageWindow = (page: number, pageSize: number) => ({ skip: (page - 1) * pageSize, take: pageSize });

/** Adresse mit Abfrage: leere Werte entfallen, die Reihenfolge der Schlüssel bleibt wie angegeben. */
export function listHref(base: string, query: Record<string, string | number | null | undefined | false>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== false && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `${base}?${text}` : base;
}

/**
 * Die Adress-Bauer einer Liste: `sortHref(key, dir)` (zurück auf Seite 1) und `pageHref(page)` (Sortierung bleibt); `filters` sind die übrigen Abfrageparameter.
 * Die Standardwerte (`defaults`) werden weggelassen, damit die Adresse kurz und stabil bleibt. `dirParam`: Name des Richtungsparameters, wenn `dir` schon etwas anderes bedeutet.
 */
export function listLinks(base: string, filters: Record<string, string | undefined | false>, current: ListParams, defaults: { sort: string; dir: SortDir }, dirParam = "dir") {
  const withSort = (sort: string, dir: SortDir) => (sort === defaults.sort && dir === defaults.dir ? {} : { sort, [dirParam]: dir });
  return {
    sortHref: (sort: string, dir: SortDir) => listHref(base, { ...filters, ...withSort(sort, dir) }),
    pageHref: (page: number) => listHref(base, { ...filters, ...withSort(current.sort, current.dir), page: page > 1 ? page : undefined }),
  };
}
