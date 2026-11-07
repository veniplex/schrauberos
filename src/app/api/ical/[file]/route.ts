import { type NextRequest } from "next/server";
import { authenticateFeed, renderFeed } from "@/modules/workshop/appointments/feed";

export const dynamic = "force-dynamic";

/**
 * Kalender-Abo (F10): `GET /api/ical/<token>.ics` – der Kalender des Besitzers des Tokens (Termine, Abwesenheiten als „abwesend“, Fristen), RFC 5545. **Ohne Sitzung und ohne Cookie:** Die Route liest nie das
 * Sitzungs-Cookie und setzt keines; das Token in der Adresse ist der ganze Zugang (`feed.ts` erklärt Rechte, Drosselung nur im Fehlerpfad und den Umfang). Ungültig – unbekannt, abgelaufen, widerrufen,
 * Besitzer gesperrt – ist immer dieselbe Antwort (401). Die Content-Security-Policy setzt der Proxy (Feed-Antworten: `default-src 'none'`, `lib/csp.ts`), alles andere diese Route:
 * `text/calendar`, `Cache-Control: private, no-store` (der Feed liegt nie in einem Zwischenspeicher), `nosniff`, kein Referrer.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const auth = await authenticateFeed(file, request);
  if (!auth.ok) return auth.response;
  const body = await renderFeed(auth.owner);
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-disposition": 'inline; filename="kalender.ics"',
    },
  });
}
