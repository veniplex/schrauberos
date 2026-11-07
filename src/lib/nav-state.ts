/** Zustand der eingeklappten Navigationsgruppen: Komma-getrennte Gruppen-IDs in diesem Cookie (Einstellung der Person, kein Geheimnis; Server und Browser lesen dasselbe). */
export const NAV_COOKIE = "so_nav";

/** Liest den Cookie-Wert; nur wohlgeformte Gruppen-IDs zählen (alles andere wird ignoriert). */
export function parseCollapsed(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[a-z][a-z0-9-]{0,30}$/.test(id))
    .slice(0, 20);
}

/** Wert für `document.cookie` (Pfad `/`, ein Jahr). */
export function collapsedCookie(ids: readonly string[], secure: boolean): string {
  return `${NAV_COOKIE}=${encodeURIComponent(ids.join(","))}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}
