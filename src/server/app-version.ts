import "server-only";
import { readMeta } from "@/lib/updates/store";

let cached: string | undefined;

/**
 * Kennung des laufenden Codes für den Service Worker (P3-5): Version und – wenn bekannt – Commit aus `version.json` (Paket und Image), in der Entwicklung ein Platzhalter.
 * Sie steckt in der Adresse des Service Workers (`/sw.js?v=…`) und im Namen seiner Zwischenspeicher: Ein Web-Update ändert sie, der Browser installiert einen neuen
 * Service Worker, und die alten Zwischenspeicher verschwinden. Wird je Prozess einmal gelesen (der Code ändert sich im laufenden Prozess nie).
 */
export function appVersion(): string {
  if (cached === undefined) {
    const meta = readMeta(process.cwd());
    cached = meta ? `${meta.version}${meta.commit ? `+${meta.commit}` : ""}` : "0.0.0-dev";
  }
  return cached;
}
