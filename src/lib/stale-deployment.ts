/**
 * Erkennt den Fehler „Server Action nicht gefunden“: Ein Tab blieb nach einem Web-Update offen, seine Aktionen kennt der neue Server
 * nicht mehr („Failed to find Server Action …. This request might be from an older or newer deployment“). Abhilfe: Seite neu laden.
 * Reine Logik; Next liefert dafür `unstable_isUnrecognizedActionError` (hier zusätzlich über die Meldung, falls der Fehler als Text ankommt).
 */
export function isStaleDeploymentError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { name?: unknown; message?: unknown };
  if (e.name === "UnrecognizedActionError") return true;
  return typeof e.message === "string" && /Failed to find Server Action|older or newer deployment/i.test(e.message);
}

/** Schutz vor Neuladeschleifen: höchstens ein automatisches Neuladen je Zeitfenster. */
export function mayAutoReload(lastReloadAt: number | null, now: number, windowMs = 30_000): boolean {
  return lastReloadAt === null || !(now - lastReloadAt < windowMs) || now < lastReloadAt;
}
