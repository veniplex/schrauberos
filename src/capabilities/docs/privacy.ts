import "server-only";
import { dayField, field } from "@/lib/privacy";
import type { FeatureId } from "@/modules/catalog";
import type { PrivacyProviderDef } from "@/modules/types";
import { db } from "@/server/db";
import { contains } from "@/server/search";

/**
 * Auskunft/Anonymisierung (P4b-5): **Fundstellen** in der Dokumentation – Seiten und ihre gespeicherten Versionen, in denen der Name, die Firma, die Kundennummer oder die E-Mail-Adresse
 * des Kunden vorkommt. Aufgelistet werden nur Titel und Zeitpunkt, nie der Inhalt. Gelöscht oder umgeschrieben wird hier nichts (Freitext lässt sich nicht verlässlich bereinigen): Die Liste
 * sagt, wo man nachsehen muss – auch in den älteren Versionen, die beim Bearbeiten einer Seite bestehen bleiben.
 */
export function docsPrivacyProvider(def: { id: string; feature: FeatureId; area: string; order: number }): PrivacyProviderDef {
  return {
    id: def.id,
    feature: def.feature,
    order: def.order,
    async collect({ terms }) {
      if (terms.length === 0) return [];
      const either = terms.flatMap((term) => [{ title: contains(term) }, { content: contains(term) }]);
      const [pages, versions] = await Promise.all([
        db.docPage.findMany({ where: { area: def.area, OR: either }, orderBy: { title: "asc" }, select: { title: true, updatedAt: true }, take: 200 }),
        db.docVersion.findMany({ where: { page: { area: def.area }, OR: either }, orderBy: { savedAt: "desc" }, select: { title: true, savedAt: true }, take: 200 }),
      ]);
      return [
        {
          id: def.id,
          title: "privacy.sections.docs",
          records: [
            ...pages.map((p) => [field("area", "privacy.f.area", def.area), field("page", "privacy.f.page", p.title), field("kind", "privacy.f.kind", "aktuelle Seite"), dayField("date", "privacy.f.date", p.updatedAt)]),
            ...versions.map((v) => [field("area", "privacy.f.area", def.area), field("page", "privacy.f.page", v.title), field("kind", "privacy.f.kind", "frühere Version"), dayField("date", "privacy.f.date", v.savedAt)]),
          ],
        },
      ];
    },
  };
}
