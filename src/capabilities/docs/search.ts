import "server-only";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import type { AppSession } from "@/server/auth/session";
import type { SearchHit } from "@/modules/types";
import { visiblePages } from "./access";
import type { DocArea } from "./areas";

/**
 * Schnellsuche in einem Dokumentationsbereich (Handbuch, IT-Dokumentation): Titel und Inhalt, **nur Seiten aus Kapiteln, die die Person lesen darf** (dieselbe Sichtbarkeitsregel wie die
 * Seiten selbst, `visiblePages`). Funktionen bringen damit ihren Suchanbieter mit (`search.ts`), ohne die Regel zu kennen.
 */
export async function searchDocPages(session: AppSession, area: DocArea, query: string, limit: number): Promise<SearchHit[]> {
  const rows = await db.docPage.findMany({
    // AND, nicht „…“-Spread: Sichtbarkeit und Suchtext haben beide ein `OR` – ein zweites würde das erste ersetzen
    where: { area, AND: [visiblePages(session, area), { OR: [{ title: contains(query) }, { content: contains(query) }] }] },
    orderBy: { title: "asc" },
    take: limit,
    select: { id: true, slug: true, title: true, category: { select: { name: true } } },
  });
  return rows.map((p) => ({ id: p.id, title: p.title, subtitle: p.category?.name, href: `/docs/${area}/${p.slug}` }));
}
