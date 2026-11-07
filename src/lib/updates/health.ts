/**
 * Bewertung der Antwort von `/api/health` durch den Launcher:
 *  - `ok`: gesund,
 *  - `wait`: startet noch / vorübergehend nicht erreichbar → weiter warten,
 *  - `fatal`: die App sagt selbst, dass sie nie gesund wird („reinstall“: fremde Migrationshistorie) → nicht bis zum Ablauf der
 *    Frist warten, sondern sofort zurückfallen (Update/Wiederherstellung).
 */
export type HealthVerdict = "ok" | "wait" | "fatal";

/**
 * Meldet die App gerade „starting“ (sie lebt und migriert die Datenbank, `/api/health` antwortet 503 mit `{ status: "starting" }`)? Dann darf der Launcher länger
 * warten als bei einer App, die gar nicht antwortet – eine große Datenbank braucht für ihre Migrationen (samt Sicherung davor) mehr als die übliche Frist.
 */
export function isStarting(httpStatus: number, body: unknown): boolean {
  const status = typeof body === "object" && body !== null ? (body as { status?: unknown }).status : undefined;
  return httpStatus === 503 && status === "starting";
}

export function healthVerdict(httpStatus: number, body: unknown): HealthVerdict {
  if (httpStatus >= 200 && httpStatus < 300) return "ok";
  const status = typeof body === "object" && body !== null ? (body as { status?: unknown }).status : undefined;
  return httpStatus === 503 && status === "reinstall" ? "fatal" : "wait";
}

/**
 * Antwort des Launchers auf einen Health-Versuch ohne HTTP-Antwort: Die Verbindung wurde angenommen (der Server lauscht), aber innerhalb der Frist kam nichts – die App ist
 * vermutlich in einem **synchronen** Schritt der Migration (better-sqlite3 blockiert den Event-Loop, auch `/api/health` antwortet dann nicht). Das ist ein Lebenszeichen
 * wie „starting“. Nicht erreichbar (Verbindung verweigert, noch nicht gestartet) ist es nicht.
 */
export function isUnresponsiveError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error.cause as { code?: unknown } | undefined)?.code ?? (error as { code?: unknown }).code;
  if (typeof code === "string" && /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ENETUNREACH)$/.test(code)) return false;
  return error.name === "TimeoutError" || error.name === "AbortError";
}

/** Millisekunden aus einer Umgebungsvariablen; leer, keine Zahl oder nicht positiv → Standardwert (ein `NaN` würde die Wartezeit sonst stillschweigend auf 0 setzen). */
export function positiveMs(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Eine Health-Abfrage (echtes Netzwerk). `null`: nicht erreichbar; `unresponsive`: Verbindung angenommen, aber keine Antwort innerhalb von `timeoutMs`. */
export async function probeHealth(port: string, timeoutMs = 2000): Promise<{ status: number; body: unknown; unresponsive?: boolean } | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (error) {
    return isUnresponsiveError(error) ? { status: 0, body: null, unresponsive: true } : null;
  }
}
