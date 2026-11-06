/**
 * Rücksprungziel nach der Anmeldung (`?next=`): nur Pfade derselben Anwendung. Geprüft wird nicht der Text, sondern das Ergebnis der
 * URL-Auflösung – so greifen auch die Tricks, bei denen Browser etwas anderes lesen als ein Textvergleich (`/\evil.example`,
 * `/<Tab>/evil.example`, `//evil.example`, `javascript:` …): Der Origin der aufgelösten URL muss der der Anwendung bleiben.
 */
const BASE = "http://schrauberos.invalid";

export function safeNext(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000 || !value.startsWith("/")) return fallback;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  // Ein kodierter Rückwärtsschrägstrich (%5C) wird von manchen Servern/Browsern wie "/" gelesen: gar nicht erst durchlassen
  if (/%5c/i.test(value)) return fallback;
  // Die Anmeldeseite selbst ist kein Ziel (Schleife)
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return fallback;
  const result = url.pathname + url.search + url.hash;
  // Die Normalisierung entfernt Punktsegmente: "/.//evil.com" wird zu "//evil.com" (protokollrelativ!). Das Ergebnis muss deshalb
  // selbst noch einmal bestehen – kein "//" am Anfang, kein Rückwärtsschrägstrich, gleicher Origin bei erneuter Auflösung.
  if (result.startsWith("//") || result.includes("\\")) return fallback;
  try {
    if (new URL(result, BASE).origin !== BASE) return fallback;
  } catch {
    return fallback;
  }
  return result;
}
