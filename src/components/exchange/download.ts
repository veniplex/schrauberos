/**
 * Dateiname aus dem Kopf `Content-Disposition` einer Antwort (`attachment; filename="kunden.csv"; filename*=UTF-8''kunden.csv`). Die UTF-8-Form gewinnt; ohne Angabe `fallback`.
 * Zeichen, die in einem Dateinamen nichts verloren haben (Pfadtrenner, Steuerzeichen), werden ersetzt – der Name kommt vom Server, wird aber nie ungeprüft zum Pfad.
 */
export function filenameFromDisposition(header: string | null, fallback = "export.csv"): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  let name: string | null = null;
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim());
    } catch {
      name = null;
    }
  }
  name ??= /filename\s*=\s*"([^"]*)"/i.exec(header)?.[1] ?? /filename\s*=\s*([^;]+)/i.exec(header)?.[1]?.trim() ?? null;
  const clean = (name ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return clean || fallback;
}
