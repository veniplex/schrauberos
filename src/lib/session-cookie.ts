/**
 * Name des Sitzungs-Cookies (ohne Abhängigkeiten, damit Proxy, Server und Tests dieselbe Konstante nutzen).
 *
 * Über HTTPS heißt das Cookie `__Host-so_session` (der Browser erzwingt dann Secure, Pfad „/“ und keine Domain – das Cookie lässt
 * sich nicht von Unterdomänen überschreiben). Im reinen HTTP-LAN gibt es `__Host-` nicht (Secure wäre unmöglich), dort gilt der
 * Klartextname. Gelesen werden immer beide.
 */
export const SESSION_COOKIE = "so_session";
export const SECURE_SESSION_COOKIE = `__Host-${SESSION_COOKIE}`;
export const SESSION_COOKIE_NAMES = [SECURE_SESSION_COOKIE, SESSION_COOKIE] as const;

export const sessionCookieName = (secure: boolean) => (secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE);

/** Das Sitzungs-Token aus einem Cookie-Speicher lesen (beide Namen; der sichere hat Vorrang). */
export function readSessionToken(get: (name: string) => { value: string } | undefined): string | undefined {
  for (const name of SESSION_COOKIE_NAMES) {
    const value = get(name)?.value;
    if (value) return value;
  }
  return undefined;
}
