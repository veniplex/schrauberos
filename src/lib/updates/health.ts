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
