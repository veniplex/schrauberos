import { NextResponse, type NextRequest } from "next/server";
import { pickerArticles } from "@/modules/workshop/parts/queries";
import { getSession } from "@/server/auth/session";

/**
 * Artikelsuche für die Auswahlfelder (Wareneingang, „Artikel einfügen“ im Auftrag): nur aktive Artikel, mit Nummer, Bezeichnung, Einheit und Bestand. Verkaufspreis und Steuersatz
 * kommen nur mit `parts.prices` mit (ohne das Recht werden sie nicht gelesen). Voraussetzung: `parts.view`.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.features.has("workshop.parts") || !session.can("parts.view")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 1) return NextResponse.json({ results: [] });

  const articles = await pickerArticles(session, q);
  return NextResponse.json({
    results: articles.map((a) => ({
      id: a.id,
      label: a.number,
      sublabel: a.name,
      number: a.number,
      name: a.name,
      unit: a.unit,
      taxBp: a.taxBp,
      stockMilli: a.stockMilli,
      ...(a.saleCents !== undefined ? { saleCents: a.saleCents } : {}),
    })),
  });
}
