import type { PrismaClient } from "@/generated/prisma/client";
import { slugify } from "@/lib/slug";

/**
 * Hilfsmittel für Demo-Seiten der Dokumentation (Querschnittsfunktion): Kapitel und Seiten samt erster Version anlegen. Die Funktionen mit Dokumentation (`handbook.manual`, `it.docs`)
 * bringen ihre Beispielseiten in ihrer `seed.ts` mit; wie die Seiten angelegt werden, steht nur hier. Ohne Server-Bezug (das Seed-Skript lädt es).
 */
export function docSeeder(db: PrismaClient) {
  const cat = async (area: string, name: string, sortOrder: number) => (await db.docCategory.create({ data: { area, name, sortOrder } })).id;
  const page = async (area: string, title: string, categoryId: string | null, content: string, pinned = false) => {
    const created = await db.docPage.create({
      data: { area, slug: slugify(title), title, categoryId, content, pinned, createdByName: "Administrator", updatedByName: "Administrator" },
    });
    await db.docVersion.create({ data: { pageId: created.id, title, content, savedByName: "Administrator" } });
  };
  return { cat, page };
}
