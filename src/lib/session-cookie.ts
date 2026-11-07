/**
 * Namen und Attribute der Cookies für Sitzung und „bekanntes Gerät“ (ohne Abhängigkeiten, damit Proxy, Server und Tests dieselbe
 * Logik nutzen).
 *
 * Über HTTPS heißen die Cookies `__Host-so_session` / `__Host-so_device` (der Browser erzwingt dann Secure, Pfad „/“ und keine
 * Domain – ein Cookie gleichen Namens lässt sich nicht von einer Unterdomäne aus setzen). Im reinen HTTP-LAN gibt es `__Host-` nicht
 * (Secure wäre unmöglich), dort gilt der Klartextname.
 *
 * **Gelesen wird immer nur der Name, der zum Übertragungsweg passt:** unter HTTPS ausschließlich `__Host-…`, sonst ausschließlich der
 * Klartextname. Würde man unter HTTPS auch das Klartext-Cookie lesen, könnte eine Unterdomäne oder ein Angreifer im selben Netz
 * („Cookie Tossing“ über HTTP) dem Opfer ein Sitzungs-Cookie unterschieben.
 */
export const SESSION_COOKIE = "so_session";
export const DEVICE_COOKIE = "so_device";
/** Zwischenzustand der Anmeldung mit zweitem Faktor: Passwort stimmt, der Code fehlt noch (kurz gültig, nur eine Kennung – der Zustand liegt im Server) */
export const PENDING_COOKIE = "so_2fa";

export const hostPrefixed = (name: string) => `__Host-${name}`;
export const cookieName = (base: string, secure: boolean) => (secure ? hostPrefixed(base) : base);

export const sessionCookieName = (secure: boolean) => cookieName(SESSION_COOKIE, secure);
export const deviceCookieName = (secure: boolean) => cookieName(DEVICE_COOKIE, secure);
export const pendingCookieName = (secure: boolean) => cookieName(PENDING_COOKIE, secure);

/**
 * Läuft die Anfrage über HTTPS? Erkannt am Header des Reverse Proxys (`x-forwarded-proto`). Ohne Proxy (reines HTTP im LAN) bleibt
 * es aus, sonst wäre keine Anmeldung möglich. `SESSION_COOKIE_SECURE=true|false` erzwingt einen Wert.
 */
export function isSecureRequest(forwardedProto: string | null | undefined, flag: string | undefined = process.env.SESSION_COOKIE_SECURE): boolean {
  if (flag === "true") return true;
  if (flag === "false") return false;
  return forwardedProto?.split(",")[0]?.trim().toLowerCase() === "https";
}

/** Das Sitzungs-Token lesen – nur unter dem Namen, der zum Übertragungsweg passt. */
export function readSessionToken(get: (name: string) => { value: string } | undefined, secure: boolean): string | undefined {
  return get(sessionCookieName(secure))?.value || undefined;
}

/** Das Geräte-Token lesen – ebenfalls nur unter dem Namen, der zum Übertragungsweg passt. */
export function readDeviceToken(get: (name: string) => { value: string } | undefined, secure: boolean): string | undefined {
  return get(deviceCookieName(secure))?.value || undefined;
}

/** Die Kennung des Anmelde-Zwischenzustands lesen – ebenfalls nur unter dem Namen, der zum Übertragungsweg passt. */
export function readPendingToken(get: (name: string) => { value: string } | undefined, secure: boolean): string | undefined {
  return get(pendingCookieName(secure))?.value || undefined;
}

/** Attribute eines Cookies, das der Browser sicher behält (HttpOnly, SameSite=Lax; unter HTTPS Secure und Pfad „/“ für `__Host-`). */
export function cookieAttributes(secure: boolean) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };
}

/** Attribute zum Löschen: gleiches Secure/Pfad wie beim Setzen (sonst ignoriert der Browser das Löschen eines `__Host-`-Cookies). */
export function clearingAttributes(secure: boolean) {
  return { ...cookieAttributes(secure), maxAge: 0, expires: new Date(0) };
}
