import type { WerbasClient } from "./types";

/**
 * Platzhalter für die echte Werbas-Anbindung.
 *
 * TODO, sobald die Schnittstelle von Werbas feststeht: hier einen Client implementieren, der
 * `ExternalCustomer`/`ExternalVehicle` liefert (REST, Datenbank-Sicht, CSV-Export …) und die
 * Zugangsdaten aus Umgebungsvariablen liest (z. B. WERBAS_URL, WERBAS_TOKEN).
 */
export function createWerbasClient(): WerbasClient {
  throw new Error("Die Werbas-Schnittstelle ist noch nicht konfiguriert (src/server/integrations/werbas/client.ts).");
}
