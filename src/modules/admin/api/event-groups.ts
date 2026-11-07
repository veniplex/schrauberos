import type { Translator } from "@/i18n/translate";
import { featureById } from "@/modules/catalog";
import type { EventGroup } from "./webhook-form";

/** Ereignisse für die Auswahl: je Funktion eine Gruppe (nur die angebotenen, also die aktiver Funktionen), Beschriftung `api.webhooks.events.<typ>`. */
export function eventGroups(events: ReadonlyArray<{ type: string; feature: string }>, { t, td }: Pick<Translator, "t" | "td">): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  for (const event of events) {
    const feature = featureById(event.feature);
    const group = groups.get(event.feature) ?? { id: event.feature, label: feature ? t(feature.nameKey) : event.feature, items: [] };
    group.items.push({ type: event.type, label: td(`api.webhooks.events.${event.type}`, event.type) });
    groups.set(event.feature, group);
  }
  return [...groups.values()];
}
