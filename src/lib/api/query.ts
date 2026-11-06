/**
 * Abfrageparameter der API (reine Logik, getestet): Seiten (`page`/`limit` mit Obergrenze), Sortierung (`sort=-name,city` über eine Whitelist je
 * Ressource) und die Version einer Zeile als ETag / `If-Match`.
 */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
export const MAX_SORT_KEYS = 3;

export type ParamError = { field: string; code: string };

const intParam = (raw: string | null, min: number, max: number): number | null => {
  if (raw === null) return null;
  if (!/^\d{1,9}$/.test(raw)) return NaN;
  const n = Number(raw);
  return n >= min && n <= max ? n : NaN;
};

export function parsePaging(params: URLSearchParams): { page: number; limit: number } | ParamError {
  const page = intParam(params.get("page"), 1, 1_000_000);
  if (Number.isNaN(page)) return { field: "page", code: "validation.invalid" };
  const limit = intParam(params.get("limit"), 1, MAX_LIMIT);
  if (Number.isNaN(limit)) return { field: "limit", code: "validation.invalid" };
  return { page: page ?? 1, limit: limit ?? DEFAULT_LIMIT };
}

export type SortKey = { key: string; dir: "asc" | "desc" };

/** `sort=name,-createdAt` → Schlüssel mit Richtung; nur Schlüssel der Whitelist, höchstens `MAX_SORT_KEYS`, keine Doppelten. */
export function parseSort(raw: string | null, allowed: readonly string[], fallback: SortKey[]): SortKey[] | ParamError {
  if (raw === null || raw === "") return fallback;
  const parts = raw.split(",");
  if (parts.length > MAX_SORT_KEYS) return { field: "sort", code: "validation.invalid" };
  const keys: SortKey[] = [];
  for (const part of parts) {
    const dir = part.startsWith("-") ? "desc" : "asc";
    const key = part.replace(/^[-+]/, "");
    if (!allowed.includes(key) || keys.some((k) => k.key === key)) return { field: "sort", code: "validation.invalid" };
    keys.push({ key, dir });
  }
  return keys;
}

export const isParamError = (value: unknown): value is ParamError => typeof value === "object" && value !== null && "field" in value && "code" in value;

/** ETag einer Zeile aus ihrer Version (Millisekunden der letzten Änderung, siehe `versionOf`). */
export const etagOf = (version: string): string => `"${version}"`;

/**
 * `If-None-Match` (nur Lesen): Hat der Client den aktuellen Stand schon? `*` passt auf jedes vorhandene Element; sonst eine Liste von Entity-Tags, schwache (`W/"…"`)
 * gelten für den Vergleich beim Lesen genauso (RFC 9110, schwacher Vergleich). Unlesbares ist „kein Treffer“ (der Client bekommt die volle Antwort).
 */
export function ifNoneMatchHit(header: string | null, etag: string): boolean {
  if (header === null) return false;
  const value = header.trim();
  if (value === "*") return true;
  const wanted = etag.replace(/^W\//, "");
  for (const part of value.split(",")) {
    const tag = part.trim().replace(/^W\//, "");
    if (tag === wanted) return true;
  }
  return false;
}

/** `If-Match` → Version. `*` und Listen werden nicht unterstützt (die Version muss genau benannt werden). */
export function parseIfMatch(header: string | null): { kind: "none" } | { kind: "invalid" } | { kind: "version"; version: string } {
  if (header === null || header.trim() === "") return { kind: "none" };
  const match = /^(?:W\/)?"(\d{1,16})"$/.exec(header.trim());
  return match ? { kind: "version", version: match[1] } : { kind: "invalid" };
}
