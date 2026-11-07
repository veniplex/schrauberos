import "server-only";

/**
 * Schutz der Upload-Routen vor Fremdaufrufen (CSRF): Die Route verlangt den eigenen Header `X-Requested-With: schrauberos` (den ein fremder Formularversand nicht
 * setzen kann und ein fremder `fetch` nur mit Vorabfrage, die wir nicht freigeben), eine gleiche Herkunft (`Origin` gleich `Host`, soweit der Browser sie
 * mitschickt; hinter einem Reverse-Proxy mit der Einstellung „Hinter Reverse-Proxy“ gilt der Host aus `X-Forwarded-Host`, weil der Proxy `Host` oft umschreibt) und – wo der Browser es meldet – `Sec-Fetch-Site` nicht von einer fremden Website. Server Actions prüft Next selbst (Origin gegen Host).
 */
export const REQUESTED_WITH_HEADER = "x-requested-with";
export const REQUESTED_WITH_VALUE = "schrauberos";

/**
 * @param behindProxy Einstellung „Hinter Reverse-Proxy“ (`isBehindProxy()`): nur dann wird `X-Forwarded-Host` (erster Eintrag) dem `Host` vorgezogen – ohne die Einstellung ließe sich
 *   der Header fälschen (er ist es allerdings nur für den Absender selbst: ein fremder Browser kann ihn nicht setzen).
 */
export function isSameOriginUpload(request: Request, behindProxy = false): boolean {
  const headers = request.headers;
  if (headers.get(REQUESTED_WITH_HEADER) !== REQUESTED_WITH_VALUE) return false;
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = headers.get("origin");
  if (origin) {
    try {
      const forwarded = behindProxy ? headers.get("x-forwarded-host")?.split(",")[0].trim().toLowerCase() : "";
      if (new URL(origin).host !== (forwarded || headers.get("host"))) return false;
    } catch {
      return false; // „null“ oder ungültig
    }
  }
  return true;
}
