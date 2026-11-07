import { Circle, type LucideIcon } from "lucide-react";
import type { IconName } from "@/modules/define";

type IconSet = Partial<Record<IconName, LucideIcon>>;

/**
 * Navigationssymbole **je Gruppe** (Modul, dazu `platform` für Übersicht und Hilfe) in eigenen Dateien: Eine neue Funktion trägt ihr Symbol in der Datei ihres Moduls ein, statt
 * eine gemeinsame Tabelle wachsen zu lassen, und geladen werden nur die Gruppen, die die Person in der Navigation sieht. Die Symbole entstehen auf dem Server und gehen als
 * fertige Elemente an die Seitenleiste (der Browser lädt keinen Symbolsatz für die Navigation).
 */
const LOADERS: Record<string, () => Promise<{ icons: IconSet }>> = {
  platform: () => import("./platform"),
  workshop: () => import("./workshop"),
  office: () => import("./office"),
  it: () => import("./it"),
  handbook: () => import("./handbook"),
  admin: () => import("./admin"),
};

/** Lädt die Symbolsätze der genannten Gruppen (unbekannte Gruppe: leerer Satz, die Einträge bekommen das Ersatzsymbol). */
export async function loadNavIcons(groupIds: readonly string[]): Promise<IconSet> {
  const sets = await Promise.all([...new Set(groupIds)].map(async (id) => (await LOADERS[id]?.())?.icons ?? {}));
  return Object.assign({}, ...sets) as IconSet;
}

export const FALLBACK_ICON: LucideIcon = Circle;
