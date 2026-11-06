import "server-only";

/**
 * Schutz der Upload-Routen vor Fremdaufrufen (CSRF): Die Route verlangt den eigenen Header `X-Requested-With: schrauberos` (den ein fremder Formularversand nicht
 * setzen kann und ein fremder `fetch` nur mit Vorabfrage, die wir nicht freigeben), eine gleiche Herkunft (`Origin` gleich `Host`, soweit der Browser sie
 * mitschickt) und – wo der Browser es meldet – `Sec-Fetch-Site` nicht von einer fremden Website. Server Actions prüft Next selbst (Origin gegen Host).
 */
export const REQUESTED_WITH_HEADER = "x-requested-with";
export const REQUESTED_WITH_VALUE = "schrauberos";

export function isSameOriginUpload(request: Request): boolean {
  const headers = request.headers;
  if (headers.get(REQUESTED_WITH_HEADER) !== REQUESTED_WITH_VALUE) return false;
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== headers.get("host")) return false;
    } catch {
      return false; // „null“ oder ungültig
    }
  }
  return true;
}
