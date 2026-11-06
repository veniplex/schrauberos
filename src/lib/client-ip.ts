import { isIP } from "node:net";

/**
 * Die Adresse des Clients – nur, wenn die Anwendung hinter einem Reverse-Proxy läuft (Einstellung „Hinter Reverse-Proxy“).
 * Ohne Proxy gilt `X-Forwarded-For` als frei erfunden und wird ignoriert: Jeder könnte sonst per Header beliebige Adressen
 * vortäuschen (und fremde Adressen drosseln oder die eigene wechseln).
 *
 * Mit Proxy zählt der **letzte** Eintrag: Den hängt der Proxy selbst an (die Adresse, von der er die Verbindung bekam); alles davor
 * stammt vom Client und kann gefälscht sein. Keine gültige Adresse → null (kein IP-Limit).
 */
export function clientIp(forwardedFor: string | null | undefined, behindProxy: boolean): string | null {
  if (!behindProxy || !forwardedFor) return null;
  const last = forwardedFor.split(",").at(-1)?.trim() ?? "";
  // IPv4-mapped IPv6 und Ports ("1.2.3.4:5678") vereinheitlichen
  const bare = last.replace(/^\[(.*)\](?::\d+)?$/, "$1").replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, "$1").replace(/^::ffff:/i, "");
  return isIP(bare) ? bare.toLowerCase() : null;
}
