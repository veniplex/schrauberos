import type { MessageKey } from "@/i18n/translate";
import { defaultOn, featureKey, type FeatureLike, type ModuleLike } from "./catalog-logic";

/**
 * Presets der Einrichtung (P2b-4): Der Funktionsumfang, mit dem eine neue Installation startet. Ein Preset ist **nur eine Liste von Funktions-IDs**, die zusätzlich zum Standard
 * (`defaultEnabled` der Funktionen, P1a-9) eingeschaltet werden; alles andere bleibt, wie es der Katalog vorgibt. Spätere Funktionen (Block 12: Aufträge, Rechnungen …) tragen sich
 * mit `defaultEnabled: false` im Katalog ein und werden hier **nur als Eintrag in `enable`** dem passenden Preset zugeschlagen – am Mechanismus ändert sich nichts.
 *
 * Unbekannte oder nicht schaltbare IDs (Pflichtfunktionen sind immer an) stoppen nichts: `planPreset` überspringt sie und meldet sie (`skipped`). `presets.test.ts` verlangt,
 * dass jedes ausgelieferte Preset nur existierende, schaltbare Funktionen nennt.
 */
export type PresetDef = {
  id: string;
  nameKey: MessageKey;
  descriptionKey: MessageKey;
  /** Vollständige Funktions-IDs („modul.funktion“), die dieses Preset zusätzlich einschaltet */
  enable: readonly string[];
};

export const PRESETS: readonly PresetDef[] = [
  { id: "basic", nameKey: "setup.presets.basic.name", descriptionKey: "setup.presets.basic.description", enable: [] },
  // Aufträge und Teile & Lager (F2/F4); die Rechnungen (F3) kommen mit ihrer Funktion dazu
  { id: "orders", nameKey: "setup.presets.orders.name", descriptionKey: "setup.presets.orders.description", enable: ["workshop.orders", "workshop.parts"] },
  // Mit Angeboten und Rechnungen (F3): Aufträge, Teile & Lager und die Rechnungserstellung
  { id: "invoicing", nameKey: "setup.presets.invoicing.name", descriptionKey: "setup.presets.invoicing.description", enable: ["workshop.orders", "workshop.parts", "office.billing", "office.reports"] },
  // Werkstattalltag (F5–F7): zusätzlich Zeiterfassung, Dokumente & Fotos und Checklisten
  { id: "daily", nameKey: "setup.presets.daily.name", descriptionKey: "setup.presets.daily.description", enable: ["workshop.orders", "workshop.parts", "office.time", "workshop.files", "workshop.checklists", "office.reports"] },
];

export type SkippedReason = "unknown" | "required" | "alreadyOn";
export type PresetPlan = {
  /** Schalter, die zu setzen sind (Funktionen, ihre harten Abhängigkeiten und ihre Module, soweit nicht ohnehin an): Schlüssel → true */
  overrides: Record<string, true>;
  skipped: Array<{ id: string; reason: SkippedReason }>;
};

/** Was ein Preset am Katalog ändert – ohne etwas zu schreiben. Reihenfolge der Schalter: Module vor Funktionen, Abhängigkeiten vor der Funktion. */
export function planPreset(preset: Pick<PresetDef, "enable">, modules: readonly ModuleLike[], features: readonly FeatureLike[]): PresetPlan {
  const overrides: Record<string, true> = {};
  const skipped: PresetPlan["skipped"] = [];
  const byId = new Map(features.map((f) => [featureKey(f), f]));

  const turnOn = (feature: FeatureLike, seen: Set<string>) => {
    const id = featureKey(feature);
    if (seen.has(id)) return;
    seen.add(id);
    const owner = modules.find((m) => m.id === feature.module);
    if (owner && !owner.required && !defaultOn(owner)) overrides[owner.id] = true;
    for (const dependency of feature.requires ?? []) {
      const required = byId.get(dependency);
      if (required) turnOn(required, seen);
    }
    if (!feature.required && !defaultOn(feature)) overrides[id] = true;
  };

  for (const id of preset.enable) {
    const feature = byId.get(id);
    if (!feature) skipped.push({ id, reason: "unknown" });
    else if (feature.required) skipped.push({ id, reason: "required" });
    else {
      const before = Object.keys(overrides).length;
      turnOn(feature, new Set());
      if (Object.keys(overrides).length === before) skipped.push({ id, reason: "alreadyOn" });
    }
  }
  return { overrides, skipped };
}

/**
 * Presets, zwischen denen die Einrichtung wählen lässt: das erste (der Standard) und jedes, das wirklich etwas einschaltet. Gibt es nur das erste, fragt die Einrichtung nicht
 * (eine Wahl ohne Wirkung wäre nur Verwirrung).
 */
export function presetChoices(presets: readonly PresetDef[], modules: readonly ModuleLike[], features: readonly FeatureLike[]): PresetDef[] {
  return presets.filter((preset, index) => index === 0 || Object.keys(planPreset(preset, modules, features).overrides).length > 0);
}
