/**
 * Pfade, deren Antworten **nie zwischengespeichert** werden (`Cache-Control: no-store`, gesetzt vom Proxy): der IT-Tresor (`/docs/vault…`). Zugangsdaten stehen nur in der Antwort der Aktion „Anzeigen“; der Kopf sorgt
 * dafür, dass weder ein Browser noch ein Zwischenspeicher davor sie oder die Seite aufbewahrt. Server Actions antworten ohnehin mit `no-store`; das hier gilt zusätzlich für jede Antwort unter diesem Pfad.
 *
 * Verglichen wird der **normalisierte** Pfad, nicht der rohe: Prozentkodierung (`/docs/%76ault`, auch doppelt: `%2576`), doppelte und einzelne Schrägstriche, `.`- und `..`-Segmente, Rückwärtsschrägstriche und
 * Groß-/Kleinschreibung führen zum selben Ergebnis wie `/docs/vault`. Ein Pfad, der sich nicht dekodieren lässt, gilt vorsichtshalber als zu schützen (der Kopf schadet nie).
 */
const MAX_DECODINGS = 3;

function normalize(pathname: string): string[] | null {
  let path = pathname;
  for (let round = 0; round < MAX_DECODINGS; round++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return null;
    }
    if (decoded === path) break;
    path = decoded;
  }
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment.toLowerCase());
  }
  return segments;
}

export const isNoStorePath = (pathname: string): boolean => {
  const segments = normalize(pathname);
  return segments === null || (segments[0] === "docs" && segments[1] === "vault");
};
