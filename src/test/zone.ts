import { resetWorkshopZone, setWorkshopZone } from "@/lib/zone";

/** Eine Prozess-Zeitzone, die mit keiner der Werkstatt-Zonen der Tests übereinstimmt (±12 h und Sommerzeit nach Süden) – wer von `TZ` abhängt, fällt damit auf. */
export const DECOY_PROCESS_ZONE = "Pacific/Auckland";

/**
 * Führt `fn` mit der Werkstatt-Zone `zone` aus, während der **Prozess** in einer anderen Zone läuft (`decoy`, Standard Pacific/Auckland). Danach ist alles wie vorher.
 * So prüfen Tests, dass Datumslogik die Einstellung der Werkstatt benutzt und nicht `TZ`.
 */
export async function withWorkshopZone<T>(zone: string, fn: () => T | Promise<T>, decoy: string = DECOY_PROCESS_ZONE): Promise<T> {
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = decoy;
    setWorkshopZone(zone);
    return await fn();
  } finally {
    resetWorkshopZone();
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
}
