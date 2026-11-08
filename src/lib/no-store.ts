/**
 * Pfade, deren Antworten **nie zwischengespeichert** werden (`Cache-Control: no-store`, gesetzt vom Proxy): der IT-Tresor (`/docs/vault…`). Zugangsdaten stehen nur in der Antwort der Aktion „Anzeigen“; der Kopf sorgt
 * dafür, dass weder ein Browser noch ein Zwischenspeicher davor sie oder die Seite aufbewahrt. Server Actions antworten ohnehin mit `no-store`; das hier gilt zusätzlich für jede Antwort unter diesem Pfad.
 */
export const isNoStorePath = (pathname: string): boolean => pathname === "/docs/vault" || pathname.startsWith("/docs/vault/");
