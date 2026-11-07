import { NextResponse, type NextRequest } from "next/server";
import { getI18n } from "@/i18n/server";
import { getSession } from "@/server/auth/session";
import { RateLimiter } from "@/lib/rate-limit";
import { searchFor, searchProvidersFor } from "@/modules/registry";

/**
 * Höchstens 40 Anfragen je 10 Sekunden und Benutzer (die Suche fragt bei jeder Eingabepause bis zu elf Tabellen ab): schützt die einzige SQLite-Datei vor einer Schleife im Browser
 * oder einem Skript mit gültiger Sitzung. Im Arbeitsspeicher (eine Instanz); über das Limit antwortet die Route mit 429 und `Retry-After`.
 */
const searchLimiter = new RateLimiter({ max: 40, windowMs: 10_000 });

/**
 * Schnellsuche über alle Funktionen. Die Plattform aggregiert nur: Welche Anbieter gelten (Funktion aktiv, Recht vorhanden) und was sie liefern, bestimmen die Funktionen selbst
 * (`searchProviders`, siehe `src/modules/registry.ts`). Ohne einen einzigen passenden Anbieter (kein Recht auf eine durchsuchbare Funktion) ist die Suche verboten.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (searchProvidersFor(session).length === 0) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const decision = searchLimiter.take(session.user.id);
  if (!decision.allowed) {
    return NextResponse.json({ error: "rate" }, { status: 429, headers: { "Retry-After": String(Math.ceil(decision.retryAfterMs / 1000)), "Cache-Control": "no-store" } });
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 2) return NextResponse.json({ groups: [] }, { headers: { "Cache-Control": "no-store" } });

  const [{ t }, groups] = await Promise.all([getI18n(), searchFor(session, q, 5)]);
  return NextResponse.json({ groups: groups.map((group) => ({ id: group.id, label: t(group.groupKey), hits: group.hits })) }, { headers: { "Cache-Control": "no-store" } });
}
