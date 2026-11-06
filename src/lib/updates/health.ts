/**
 * Bewertung der Antwort von `/api/health` durch den Launcher:
 *  - `ok`: gesund,
 *  - `wait`: startet noch / vorübergehend nicht erreichbar → weiter warten,
 *  - `fatal`: die App sagt selbst, dass sie nie gesund wird („reinstall“: fremde Migrationshistorie) → nicht bis zum Ablauf der
 *    Frist warten, sondern sofort zurückfallen (Update/Wiederherstellung).
 */
export type HealthVerdict = "ok" | "wait" | "fatal";

export function healthVerdict(httpStatus: number, body: unknown): HealthVerdict {
  if (httpStatus >= 200 && httpStatus < 300) return "ok";
  const status = typeof body === "object" && body !== null ? (body as { status?: unknown }).status : undefined;
  return httpStatus === 503 && status === "reinstall" ? "fatal" : "wait";
}
