import type { Translator } from "@/i18n/translate";
import { featureById } from "@/modules/catalog";
import type { EventGroup } from "./webhook-form";

/** Ereignisse für die Auswahl: je Funktion eine Gruppe (nur die angebotenen, also die aktiver Funktionen), Beschriftung `api.webhooks.events.<typ>`. */
export function eventGroups(events: ReadonlyArray<{ type: string; feature: string; off?: boolean }>, { t, td }: Pick<Translator, "t" | "td">): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  for (const event of events) {
    const feature = featureById(event.feature);
    // Ereignisse einer ausgeschalteten Funktion bleiben abonniert, stehen aber in eigener Gruppe („… (ausgeschaltet)“)
    const id = event.off ? `off:${event.feature}` : event.feature;
    const name = feature ? t(feature.nameKey) : event.feature;
    const group = groups.get(id) ?? { id, label: event.off ? t("api.webhooks.form.featureOff", { name }) : name, items: [] };
    group.items.push({ type: event.type, label: td(`api.webhooks.events.${event.type}`, event.type) });
    groups.set(id, group);
  }
  return [...groups.values()];
}
