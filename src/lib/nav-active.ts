/** Passt der Pfad zum Navigationsziel? `/` nur exakt, sonst das Ziel selbst oder ein Unterpfad davon. */
function matches(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Welcher Eintrag der Navigation ist aktiv? **Der längste passende Eintrag gewinnt** – so ist bei `/fleet/licenses` nur
 * „Führerscheinkontrolle“ aktiv und nicht zusätzlich „Fuhrpark“ (`/fleet`). Ohne Treffer null; es ist nie mehr als einer aktiv.
 */
export function activeHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (matches(pathname, href) && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
