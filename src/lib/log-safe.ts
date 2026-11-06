/**
 * Log-Hygiene: Fehler werden nur mit Art und Fehlercode protokolliert (z. B. `PrismaClientKnownRequestError P2002`), nie mit Meldung,
 * Stack oder Nutzdaten – die enthalten oft Eingaben (Namen, Nummern, Passwörter in Fehlertexten). Zeichenfolgen, die trotzdem ins
 * Log gelangen (z. B. Bezeichnungen), werden von Steuerzeichen befreit, damit niemand Zeilen fälschen kann (Log-Injection).
 */

// C0-/C1-Steuerzeichen sowie Zeilen- und Absatztrenner (U+2028/U+2029)
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;

/** Entfernt Steuerzeichen (Zeilenumbrüche, ESC …), ersetzt sie durch ein Leerzeichen und kürzt. */
export function stripControl(value: string, max = 200): string {
  const clean = value.replace(CONTROL, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Kurzbeschreibung eines Fehlers ohne Nutzdaten: Klasse und Code. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const name = stripControl(error.constructor?.name || error.name || "Error", 60);
    return typeof code === "string" || typeof code === "number" ? `${name} ${stripControl(String(code), 40)}` : name;
  }
  return typeof error;
}

/** Protokolliert einen Fehler mit Bereich und Art/Code (kein Stack, keine Meldung). */
export function logError(scope: string, error: unknown): void {
  console.error(`[${stripControl(scope, 60)}] ${describeError(error)}`);
}
