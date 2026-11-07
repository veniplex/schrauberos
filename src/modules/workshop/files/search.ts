import "server-only";
import type { SearchProviderDef } from "@/modules/types";
import { searchFiles } from "./queries";

/** Schnellsuche: Dateien und Fotos nach Beschriftung, Name, Kennzeichen und Auftragsnummer – nur, was die Person nach den Rechten der Entität sehen darf. Der Treffer führt zum Fahrzeug bzw. Auftrag. */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "files",
    feature: "workshop.files",
    permission: "files.view",
    groupKey: "files.search.group",
    order: 25,
    async search(q, { session, limit }) {
      const rows = await searchFiles(session, q, limit);
      return rows.map((f) => ({
        id: f.id,
        title: f.caption || f.name,
        subtitle: f.ownerLabel,
        href: f.ownerType === "vehicle" ? `/vehicles/${f.ownerId}` : `/orders/${f.ownerId}`,
      }));
    },
  },
];
